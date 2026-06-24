// AXIS 2 — human-in-the-loop via an agent session, protocol half. A scripted agent has
// already presented a grouping; a real browser session is simulated over the server's
// WebSocket (the human marks + comments + signals done), and the agent's `dispatch
// --wait` is driven through the real `callWait` client. Asserts the three wait states
// (done / reviewInProgress / reviewIdle) end-to-end and the addressed-by-answer flow.
// The browser *rendering* half (tier badges, inline answers) lives in the Playwright
// specs; this proves the CLI↔server↔human handshake the browser sits on top of.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { MarkAuthor } from "@cara/core";
import { makeReviewFixture } from "../support/fixture-repo.ts";
import { compose } from "../../packages/node/src/server/compose.ts";
import { startServer } from "../../packages/node/src/server/server.ts";
import { parseCommand } from "../../packages/node/src/cli/parse.ts";
import { callWait } from "../../packages/node/src/cli/wait.ts";
import { runCli } from "../../packages/node/src/cli.ts";
import { writeDiscovery } from "../../packages/node/src/cli/discovery.ts";
import type { CliIo } from "../../packages/node/src/cli/output.ts";
import type { AppRouter } from "../../packages/node/src/server/router.ts";

const AGENT: MarkAuthor = { tier: "agent", reviewer: "security" };

/** Capture a CLI verb's stdout so an in-process `runCli` reads as a real cross-process call. */
function capture(stdin = ""): { io: CliIo; json(): Record<string, unknown> } {
  const out: string[] = [];
  return {
    io: { write: (t) => out.push(t), readStdin: () => Promise.resolve(stdin) },
    json: () => JSON.parse(out.join("")) as Record<string, unknown>,
  };
}

function specOf(range: string) {
  const cmd = parseCommand(["atoms", range]);
  if (cmd.verb !== "atoms") throw new Error("unreachable");
  return cmd.spec;
}

/** Boot a server over a freshly-presented review; return everything a test drives. */
async function bootSession() {
  const fixture = await makeReviewFixture();
  const spec = specOf(fixture.range);
  const backend = await compose({ cwd: fixture.dir, spec });
  const snapshot = await backend.service.presentGrouping(spec, trivialGrouping(await firstHashes(backend, spec)));
  const server = await startServer(backend);
  const human = humanClient(server.url);
  return {
    url: server.url,
    dir: fixture.dir,
    range: fixture.range,
    stateDir: join(fixture.dir, ".git", "cara", "reviews"),
    context: snapshot.context,
    spec,
    firstHash: snapshot.review.masterList[0]!.hash,
    backend,
    human: human.trpc,
    async close() {
      human.close();
      await server.close();
      await fixture.cleanup();
    },
  };
}

async function firstHashes(backend: Awaited<ReturnType<typeof compose>>, spec: ReturnType<typeof specOf>) {
  const view = await backend.service.getAtoms(spec);
  return view.atoms.map((a) => a.hash);
}
/** A throwaway one-section grouping for the session — not the production git-order floor. */
function trivialGrouping(hashes: readonly string[]): unknown {
  return {
    chapters: [
      { title: "Changes", summary: "every change", sections: [{ title: "All", summary: "all atoms", atomHashes: hashes }] },
    ],
  };
}

/** A tRPC client over the server's WS — the browser-channel (human tier) actor. */
function humanClient(url: string) {
  const ws = createWSClient({ url: url.replace(/^http/, "ws") });
  const trpc = createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] });
  return { trpc, close: () => ws.close() };
}

test("dispatch --wait returns done with the human's marks + comment once they finish", async () => {
  const s = await bootSession();
  try {
    // The human marks an atom done and leaves a question, then clicks "done reviewing".
    await s.human.mark.mutate({ context: s.context, atomHash: s.firstHash, disposition: "done" });
    await s.human.comment.mutate({ context: s.context, atomHash: s.firstHash, body: "Is this guard correct?" });
    await s.human.done.mutate({ context: s.context });

    const verdict = await callWait(s.url, s.context, {});
    assert.equal(verdict.state, "done");
    assert.ok(verdict.state === "done");
    if (verdict.state === "done") {
      const comment = verdict.comments.find((c) => c.body === "Is this guard correct?");
      assert.ok(comment, "the human's comment reaches the agent");
      assert.equal(comment!.tier, "human", "a browser-channel write is always the human tier");
      assert.equal(comment!.reviewer, null);
    }
  } finally {
    await s.close();
  }
});

test("dispatch --wait reports reviewIdle after the idle threshold with no UI activity", async () => {
  const s = await bootSession();
  try {
    await Bun.sleep(60); // no mutations: activity stays at boot time
    const verdict = await callWait(s.url, s.context, { idleMs: 25 });
    assert.equal(verdict.state, "reviewIdle");
  } finally {
    await s.close();
  }
});

test("dispatch --wait reports reviewInProgress while the human is still active", async () => {
  const s = await bootSession();
  try {
    await s.human.mark.mutate({ context: s.context, atomHash: s.firstHash, disposition: "done" }); // recent activity
    const verdict = await callWait(s.url, s.context, { maxBlockMs: 100, idleMs: 60_000 });
    assert.equal(verdict.state, "reviewInProgress");
  } finally {
    await s.close();
  }
});

test("the agent answers an open human comment → it flips to addressed", async () => {
  const s = await bootSession();
  try {
    const snap = await s.human.comment.mutate({ context: s.context, atomHash: s.firstHash, body: "Why no null check?" });
    const commentId = snap.comments[0]!.id;
    await s.human.done.mutate({ context: s.context });

    // The agent answers over its own channel — the `submit` verb (agent tier), not the browser WS.
    await s.backend.service.submit(s.spec, { answers: [{ commentId, answer: "**Addressed** — guard added." }] }, AGENT);

    const view = await s.backend.service.dispatch(s.spec);
    const dispatched = view.comments.find((c) => c.id === commentId);
    assert.ok(dispatched);
    assert.equal(dispatched!.status, "addressed");
    assert.equal(dispatched!.answer, "**Addressed** — guard added.");
  } finally {
    await s.close();
  }
});

// --- polish pass (ADR-0012): cross-axis round trips the browser sits on top of ---

/** A fully-summarised one-section grouping over the given hashes (passes the summary gate). */
function summarisedGrouping(title: string, hashes: readonly string[]): unknown {
  return {
    chapters: [{ title, summary: `${title} — every change`, sections: [{ title, summary: "all atoms", atomHashes: hashes }] }],
  };
}

test("line-pointer comment round trip: a human's line-anchored comment reaches dispatch with a resolved line", async () => {
  const s = await bootSession();
  try {
    // Find an atom carrying an added line, and the exact text the human pins to.
    const atomsView = await s.backend.service.getAtoms(s.spec);
    const atom = atomsView.atoms.find((a) => a.newLines > 0 && a.lines.some((l) => l.kind === "added"))!;
    const addedLine = atom.lines.find((l) => l.kind === "added")!;

    // The human (browser channel) pins the comment to that line by content + side.
    await s.human.comment.mutate({
      context: s.context,
      atomHash: atom.hash,
      body: "This specific line needs a guard.",
      line: { side: "added", text: addedLine.text },
    });

    // The agent reads it over the CLI `dispatch` verb — a separate composition over the
    // shared on-disk log — and the comment carries the *resolved* line number.
    const cap = capture();
    await runCli(["dispatch", "--range", s.range], { cwd: s.dir, io: cap.io });
    const comments = cap.json()["comments"] as { atomHash: string; body: string; tier: string; line: number | null }[];
    const pinned = comments.find((c) => c.body === "This specific line needs a guard.")!;
    assert.equal(pinned.tier, "human");
    assert.equal(typeof pinned.line, "number"); // resolved, not the raw pointer
    assert.ok(pinned.line! > 0);
  } finally {
    await s.close();
  }
});

test("a comment-only atom is gap-closed: dispatch counts it as accounted though unaddressed", async () => {
  const s = await bootSession();
  try {
    // The human comments on one atom and disposes nothing.
    await s.human.comment.mutate({ context: s.context, atomHash: s.firstHash, body: "Needs a second look." });

    const cap = capture();
    await runCli(["dispatch", "--range", s.range], { cwd: s.dir, io: cap.io });
    const progress = cap.json()["progress"] as { total: number; addressed: number; accounted: number };
    assert.equal(progress.addressed, 0); // no disposition anywhere
    assert.equal(progress.accounted, 1); // the comment-only atom is gap-closed (ADR-0012 §f)
    assert.ok(progress.total >= 1);
  } finally {
    await s.close();
  }
});

test("reshape lifecycle: a human request surfaces on dispatch, a re-present clears it on the one live server", async () => {
  const s = await bootSession();
  try {
    // The discovery record points the CLI present-client at THIS live in-process server
    // (its pid is the running test process — unmistakably alive).
    await writeDiscovery(s.stateDir, s.context, { url: s.url, pid: process.pid, ts: 1 });

    // 1) The human asks for a reshape over the browser WS.
    await s.human.reshapeRequest.mutate({ context: s.context, body: "split the tests out" });

    // 2) The agent sees it on `dispatch`, with a re-present `next` hint.
    const before = capture();
    await runCli(["dispatch", "--range", s.range], { cwd: s.dir, io: before.io });
    const beforeOut = before.json();
    assert.equal(beforeOut["reshape"], "split the tests out");
    assert.match(beforeOut["next"] as string, /reshape|Re-group/);
    assert.match(beforeOut["next"] as string, /split the tests out/);

    // 3) The agent re-presents. `present` finds the live server and HANDS OFF — it must
    //    never boot a sibling (assert the boot seam is untouched). The real handover
    //    client drives the live server's `reshape` mutation over WS.
    const hashes = (await s.backend.service.getAtoms(s.spec)).atoms.map((a) => a.hash);
    const grouping = JSON.stringify(summarisedGrouping("Reshaped", hashes));
    let booted = false;
    const present = capture(grouping);
    await runCli(["present", "-", "--range", s.range], {
      cwd: s.dir,
      io: present.io,
      bootServer: async () => {
        booted = true;
        return { url: "http://should-not-boot" };
      },
    });
    const presentOut = present.json();
    assert.equal(presentOut["reshaped"], true); // live-refresh, not a cold boot
    assert.equal(presentOut["opened"], true);
    assert.equal(booted, false); // single server per context — no sibling process

    // 4) The re-present cleared the reshape (a fresh `presented` marker resolves it).
    const after = capture();
    await runCli(["dispatch", "--range", s.range], { cwd: s.dir, io: after.io });
    assert.equal(after.json()["reshape"], null);

    // 5) The live server now serves the new grouping — what a reconnecting browser reads.
    const snap = await s.human.snapshot.query({ context: s.context });
    assert.equal(snap.review.chapters[0]?.title, "Reshaped");
  } finally {
    await s.close();
  }
});
