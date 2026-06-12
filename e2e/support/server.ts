// Boot the real backend for an e2e run. Composes the LLM-free backend, presents
// a grouping so the snapshot has chapters, starts the server, and returns the
// URL with `?context=<ctx>` so the browser's `main.ts` can load the snapshot.
//
// Three paths:
//   bootReal               — groups by file (one section per file), one chapter.
//   bootWithAgent          — grouping is provided by the caller; for summary/tier tests.
//   bootWithAnsweredComment — seeds a comment + answer; for inline-answer tests.
//   bootWithAgentMarks     — seeds agent-tier marks; for tier-badge tests.
//
// Each returns the live URL + a close(). One server per test keeps runs isolated.

import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Atom, CommentLinePointer, MarkAuthor, ReviewContext } from "@cara/core";
import { parseCommand } from "../../packages/node/src/cli/parse.ts";
import { compose } from "../../packages/node/src/server/compose.ts";
import { startServer } from "../../packages/node/src/server/server.ts";
import type { RpcDeps } from "../../packages/node/src/server/router.ts";

export interface BootedServer {
  readonly url: string;
  close(): Promise<void>;
}

export interface GroupingAgent {
  grouping(atoms: readonly Atom[]): unknown;
}

/** Built UI assets the server serves. */
function webRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../../apps/web/dist"), resolve(here, "web")];
  return candidates.find((p) => existsSync(p)) ?? resolve(here, "../../apps/web/dist");
}

/** Parse a `base..head` range string into a DiffSpec via the canonical CLI parser. */
function parseSpec(range: string) {
  const cmd = parseCommand(["atoms", range]);
  if (cmd.verb !== "atoms") throw new Error(`Unexpected verb: ${cmd.verb}`);
  return cmd.spec;
}

/**
 * Default grouping: one chapter with one section per file.
 * Populates the nav tree without needing an LLM.
 */
function defaultGrouping(atoms: readonly Atom[]): unknown {
  const byFile = new Map<string, string[]>();
  for (const atom of atoms) {
    const hashes = byFile.get(atom.path);
    if (hashes) hashes.push(atom.hash);
    else byFile.set(atom.path, [atom.hash]);
  }
  const sections = [...byFile].map(([path, atomHashes]) => ({ title: path, summary: `Changes in ${path}.`, atomHashes }));
  return { chapters: [{ title: "Changes", summary: "All changes in this review.", sections }] };
}

/** Compose the backend, present a grouping, start the server, return URL + close. */
async function bootSeeded(
  repoDir: string,
  range: string,
  grouping: (atoms: readonly Atom[]) => unknown,
  seed: (backend: RpcDeps, context: ReviewContext) => Promise<void>,
): Promise<BootedServer> {
  const spec = parseSpec(range);
  const backend = await compose({ cwd: repoDir, spec });
  const atomsView = await backend.service.getAtoms(spec);
  const snapshot = await backend.service.presentGrouping(spec, grouping(atomsView.atoms));
  const { context } = snapshot;
  await seed(backend, context);
  const server = await startServer(backend, { webRoot: webRoot() });
  return { url: `${server.url}?context=${encodeURIComponent(context)}`, close: () => server.close() };
}

/** Boot with the default file-grouped grouping. Used by most e2e specs. */
export function bootReal(repoDir: string, range: string): Promise<BootedServer> {
  return bootSeeded(repoDir, range, defaultGrouping, () => Promise.resolve());
}

/** Boot with an injected grouping agent (composition-root seam). */
export function bootWithAgent(repoDir: string, range: string, agent: GroupingAgent): Promise<BootedServer> {
  return bootSeeded(repoDir, range, (atoms) => agent.grouping(atoms), () => Promise.resolve());
}

/**
 * Boot with a pre-seeded comment + answer on the first atom, so inline-answer rendering
 * can be tested without needing a live CLI agent session.
 */
export function bootWithAnsweredComment(repoDir: string, range: string): Promise<BootedServer> {
  return bootSeeded(repoDir, range, defaultGrouping, async (backend, context) => {
    const atomsView = await backend.service.getAtoms(parseSpec(range));
    const firstAtom = atomsView.atoms[0];
    if (firstAtom === undefined) return;
    const human: MarkAuthor = { tier: "human", reviewer: null };
    const snap = await backend.service.comment(context, firstAtom.hash, "This needs a guard.", human);
    const commentId = snap.comments[0]?.id;
    if (commentId !== undefined) {
      const agentAuthor: MarkAuthor = { tier: "agent", reviewer: null };
      await backend.service.submit(
        parseSpec(range),
        { answers: [{ commentId, answer: "**Addressed** — guard added in the next commit." }] },
        agentAuthor,
      );
    }
  });
}

/**
 * Boot with agent-tier marks pre-seeded on all atoms in the first section, so the
 * tier-badge rendering can be tested in the nav.
 */
export function bootWithAgentMarks(repoDir: string, range: string, reviewer = "security"): Promise<BootedServer> {
  return bootSeeded(repoDir, range, defaultGrouping, async (backend, context) => {
    const snap = await backend.service.snapshot(context);
    const agentAuthor: MarkAuthor = { tier: "agent", reviewer };
    const firstSection = snap.review.chapters[0]?.sections[0];
    if (firstSection !== undefined) {
      for (const atom of firstSection.atoms) {
        await backend.service.mark(context, atom.hash, "done", agentAuthor);
      }
    }
  });
}

export interface ReshapeRoundTripServer extends BootedServer {
  /** The raw server origin (no `?context=`), for the CLI present-handover client. */
  readonly rawUrl: string;
  /** The review context the live server serves. */
  readonly context: ReviewContext;
  /** The master-list hashes, so a test can build a fresh grouping to re-present. */
  readonly hashes: readonly string[];
}

/**
 * Boot a live server and expose the handles a cross-axis reshape round trip needs: the
 * browser loads `url`, the human requests a reshape in the UI, then the test drives the
 * agent's re-present against `rawUrl`/`context` (the CLI present-handover) to prove the
 * open browser live-refreshes. One server throughout — the single-server invariant.
 */
export async function bootReshapeRoundTrip(repoDir: string, range: string): Promise<ReshapeRoundTripServer> {
  const spec = parseSpec(range);
  const backend = await compose({ cwd: repoDir, spec });
  const atomsView = await backend.service.getAtoms(spec);
  const snapshot = await backend.service.presentGrouping(spec, defaultGrouping(atomsView.atoms));
  const { context } = snapshot;
  const server = await startServer(backend, { webRoot: webRoot() });
  return {
    url: `${server.url}?context=${encodeURIComponent(context)}`,
    rawUrl: server.url,
    context,
    hashes: atomsView.atoms.map((a) => a.hash),
    close: () => server.close(),
  };
}

/**
 * Boot with a pre-seeded line-anchored comment on the first added line of the first
 * atom that has added lines — for line-anchor rendering tests.
 */
export function bootWithLineComment(repoDir: string, range: string): Promise<BootedServer> {
  return bootSeeded(repoDir, range, defaultGrouping, async (backend, context) => {
    const atomsView = await backend.service.getAtoms(parseSpec(range));
    // Find the first atom with at least one added line.
    const atom = atomsView.atoms.find((a) => a.newLines > 0 && a.lines.some((l) => l.kind === "added"));
    if (atom === undefined) return;
    const addedLine = atom.lines.find((l) => l.kind === "added");
    if (addedLine === undefined) return;
    const human: MarkAuthor = { tier: "human", reviewer: null };
    const pointer: CommentLinePointer = { side: "added", text: addedLine.text };
    await backend.service.comment(context, atom.hash, "This specific line needs review.", human, pointer);
  });
}
