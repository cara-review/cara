// GitLedgerStore: the CARA audit ledger as a committed orphan ref (ADR-0005
// rewrite, TN-26-034). A `ReviewStore` over git instead of local JSONL — the
// browser and CLI review paths persist marks here, so a review fact becomes a
// durable, shareable repo fact rather than gitignored runtime state.
//
// Layout — `refs/cara/ledger` (an orphan commit chain, off the working tree and
// off normal history):
//
//   refs/cara/ledger                  (one commit per append)
//   └── <contextHash>/                # per ReviewContext (same SHA-256 key as before)
//       └── <factId>.<nonce>.json     # one MarkEvent; factId = hash of the canonical fact
//
// The filename pairs the content-address (factId = hash of the canonical bytes)
// with a per-append random nonce. The factId proves integrity — `load` re-checks
// each blob's bytes against its filename's leading segment, so a relabelled or
// swapped fact is rejected — while the nonce keeps every append on a distinct path.
// Two appends with byte-identical canonical facts (same atom, disposition and `ts`
// under a fixed clock — a rapid identical re-mark) are GENUINELY DISTINCT events:
// distinct nonces give them distinct paths, so both are preserved rather than one
// silently dropped. Concurrent writers therefore never collide (disjoint nonces ⇒
// disjoint paths), and two clones' ledgers still merge as a clean tree union (the
// concurrent-reviewer story).
//
// Integrity caveat: a fact's author tier is ATTRIBUTED, not AUTHENTICATED. The
// tier is stamped at the channel boundary on write (browser ⇒ human, CLI ⇒ agent;
// ADR-0004) and carried verbatim, but anyone with write access to `refs/cara/ledger`
// can plant a fact under any tier. The committed ledger proves what a writer claimed,
// not who approved — a gate must treat tier as advisory until commit signing lands
// (deferred fast-follow).
//
// The order wrinkle (TN-26-034): the fold (`project`) is order-dependent —
// last-write-wins marks, and `commentId` is the ordinal among `commented`
// events — but a content-addressed blob tree has no inherent order and a fixed
// clock collides `ts`. So append order is reconstructed from the COMMIT TOPOLOGY:
// one commit per append, first-parent oldest→newest = total append order. Each
// commit contributes exactly the one blob it added.
//
// Working tree untouched: every mutation goes through git plumbing
// (`hash-object`, a scratch `GIT_INDEX_FILE`, `commit-tree`, `update-ref`) — the
// ledger is never checked out and the user's index/worktree are never touched.
// Holds facts keyed by `atomHash` only, never the atom set (ADR-0004).
//
// Travel: the ledger rides git but needs an explicit refspec, e.g.
//   git config --add remote.origin.push 'refs/cara/*:refs/cara/*'
//   git config --add remote.origin.fetch 'refs/cara/*:refs/cara/*'

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MarkEvent, ReviewContext, ReviewStore } from "@clear-diff/core";
import { contextHash } from "../context-hash.ts";
import { isMarkEvent } from "../mark-event.ts";
import { GitError, runGit, runGitStdin } from "./run.ts";

/** The orphan ref the ledger lives on. */
export const LEDGER_REF = "refs/cara/ledger";

/**
 * A fixed identity for the ledger commit metadata. Facts are attributed in their own
 * payload (the `author` tier, channel-inferred), so the commit's author/committer is
 * pure bookkeeping — pinning it keeps `commit-tree` working without any host or global
 * git identity, and keeps the ledger reproducible. (Signing is a deferred fast-follow.)
 */
const LEDGER_IDENTITY = {
  GIT_AUTHOR_NAME: "clear-diff",
  GIT_AUTHOR_EMAIL: "ledger@clear-diff",
  GIT_COMMITTER_NAME: "clear-diff",
  GIT_COMMITTER_EMAIL: "ledger@clear-diff",
} as const;

/**
 * Canonical bytes of a fact: JSON with object keys sorted recursively, so the
 * factId is stable regardless of source key order. The factId is the SHA-256 of
 * these bytes; the blob stores them verbatim (the filename's nonce is NOT in the
 * blob), so the integrity check on load can recompute and match the leading segment.
 */
function canonicalFact(event: MarkEvent): string {
  return JSON.stringify(sortKeys(event));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  return sorted;
}

function factId(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

export class GitLedgerStore implements ReviewStore {
  readonly #cwd: string;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  async load(context: ReviewContext): Promise<readonly MarkEvent[]> {
    const tip = await this.#tip();
    if (tip === null) return [];
    const prefix = `${contextHash(context)}/`;

    // First-parent walk, oldest→newest = append order. For each commit, the one path
    // it ADDED under this context's prefix is that append's fact (commits whose added
    // path is under another context are skipped). Reading the added blob per commit
    // recovers total order.
    const shas = (await runGit(["rev-list", "--first-parent", "--reverse", tip], this.#cwd))
      .split("\n")
      .filter((line) => line !== "");

    const events: MarkEvent[] = [];
    for (const sha of shas) {
      const path = (await this.#addedPaths(sha)).find((p) => p.startsWith(prefix));
      if (path === undefined) continue;
      events.push(await this.#readFact(sha, path));
    }
    return events;
  }

  async loadAll(): Promise<readonly MarkEvent[]> {
    const tip = await this.#tip();
    if (tip === null) return [];
    // Every fact across ALL contexts (ADR-0014): the same chain walk as load(), without the
    // per-context prefix filter. Order is irrelevant — the repo-wide fold is existence-based —
    // so this list carries no ordering guarantee and must never reach project().
    const shas = (await runGit(["rev-list", "--first-parent", "--reverse", tip], this.#cwd))
      .split("\n")
      .filter((line) => line !== "");
    const events: MarkEvent[] = [];
    for (const sha of shas) {
      for (const path of await this.#addedPaths(sha)) events.push(await this.#readFact(sha, path));
    }
    return events;
  }

  /** Read, parse, and integrity-check the fact blob at `sha:path`. */
  async #readFact(sha: string, path: string): Promise<MarkEvent> {
    const raw = await runGit(["cat-file", "-p", `${sha}:${path}`], this.#cwd);
    const parsed: unknown = JSON.parse(raw);
    if (!isMarkEvent(parsed)) throw new Error(`Corrupt ledger fact ${LEDGER_REF}:${path}`);
    // Content-address integrity: a fact's filename IS its factId. Recompute it from the canonical
    // bytes and reject a relabelled or swapped blob — a cheap tamper check the content-addressing
    // affords (it does not authenticate the author tier; see header).
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (!(basename.startsWith(`${factId(canonicalFact(parsed))}.`) && basename.endsWith(".json"))) {
      throw new Error(`Corrupt ledger fact ${LEDGER_REF}:${path} (factId mismatch)`);
    }
    return parsed;
  }

  async append(context: ReviewContext, event: MarkEvent): Promise<void> {
    const canonical = canonicalFact(event);
    // factId addresses the content (integrity); the per-append nonce keeps every append on a
    // distinct path, so two byte-identical facts are preserved as distinct events, not deduped
    // to one. The nonce lives only in the filename — the blob stays pure canonical bytes.
    const path = `${contextHash(context)}/${factId(canonical)}.${randomUUID()}.json`;
    const blob = (await runGitStdin(["hash-object", "-w", "--stdin"], this.#cwd, canonical)).trim();

    // CAS loop: build a commit on the current tip and swap the ref atomically. A
    // concurrent append moves the tip first → update-ref fails → rebuild on the new tip.
    // Disjoint paths (distinct nonces) mean the rebuild always succeeds.
    for (;;) {
      const tip = await this.#tip();
      const tree = await this.#treeWith(tip, path, blob);
      const args = tip === null ? ["commit-tree", tree, "-m", "cara"] : ["commit-tree", tree, "-p", tip, "-m", "cara"];
      const commit = (await runGitStdin(args, this.#cwd, "", LEDGER_IDENTITY)).trim();
      if (await this.#compareAndSwap(tip, commit)) return;
    }
  }

  /** The ledger tip SHA, or null when the ref does not yet exist. */
  async #tip(): Promise<string | null> {
    try {
      return (await runGit(["rev-parse", "--verify", "--quiet", `${LEDGER_REF}^{commit}`], this.#cwd)).trim();
    } catch (err) {
      // `rev-parse --verify --quiet` exits 1 only for a missing ref; a real fault keeps its code.
      if (err instanceof GitError && err.code === 1) return null;
      throw err;
    }
  }

  /** The paths a commit ADDED (always one — append writes exactly one blob per commit). */
  async #addedPaths(sha: string): Promise<readonly string[]> {
    const out = await runGit(
      ["diff-tree", "--no-commit-id", "--name-only", "--diff-filter=A", "-r", "--root", sha],
      this.#cwd,
    );
    return out.split("\n").filter((line) => line !== "");
  }

  /** Build the new ledger tree: the tip's tree plus `path → blob`, via a scratch index. */
  async #treeWith(tip: string | null, path: string, blob: string): Promise<string> {
    const scratch = await mkdtemp(join(tmpdir(), "cara-ledger-"));
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    try {
      if (tip !== null) await runGitStdin(["read-tree", `${tip}^{tree}`], this.#cwd, "", env);
      await runGitStdin(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], this.#cwd, "", env);
      return (await runGitStdin(["write-tree"], this.#cwd, "", env)).trim();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /** Atomically move the ref from `old` (or create when null) to `next`. False on contention. */
  async #compareAndSwap(old: string | null, next: string): Promise<boolean> {
    try {
      const args =
        old === null
          ? ["update-ref", LEDGER_REF, next, ""] // "" old-value = create only
          : ["update-ref", LEDGER_REF, next, old];
      await runGit(args, this.#cwd);
      return true;
    } catch (err) {
      // A lost CAS race — another writer moved the tip first — is git's "cannot lock ref"
      // (exit 128). Match the signature so a genuine fault (any other failure) still surfaces.
      if (err instanceof GitError && err.stderr.includes("cannot lock ref")) return false;
      throw err;
    }
  }
}
