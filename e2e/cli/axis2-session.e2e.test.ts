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
import type { MarkAuthor } from "@clear-diff/core";
import { makeReviewFixture } from "../support/fixture-repo.ts";
import { compose } from "../../packages/node/src/server/compose.ts";
import { startServer } from "../../packages/node/src/server/server.ts";
import { parseCommand } from "../../packages/node/src/cli/parse.ts";
import { callWait } from "../../packages/node/src/cli/wait.ts";
import type { AppRouter } from "../../packages/node/src/server/router.ts";

const AGENT: MarkAuthor = { tier: "agent", reviewer: "security" };

function specOf(range: string) {
  const cmd = parseCommand(["atoms", range]);
  if (cmd.verb !== "atoms") throw new Error("unreachable");
  return cmd.spec;
}

/** Boot a server over a freshly-presented review; return everything a test drives. */
async function bootSession() {
  const fixture = await makeReviewFixture();
  const spec = specOf(fixture.range);
  const backend = await compose({ cwd: fixture.dir, spec, stateDir: join(fixture.dir, ".agent-state", "reviews") });
  const snapshot = await backend.service.presentGrouping(spec, trivialGrouping(await firstHashes(backend, spec)));
  const server = await startServer(backend);
  const human = humanClient(server.url);
  return {
    url: server.url,
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
  return { chapters: [{ title: "Changes", sections: [{ title: "All", atomHashes: hashes }] }] };
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
