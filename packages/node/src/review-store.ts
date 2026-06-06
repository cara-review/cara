// JSONL ReviewStore adapter (ADR-0005): an append-only event log per review
// context, one JSON-encoded MarkEvent per line.
//
// All persistence concerns — base dir, context→filename derivation, line
// framing, node:crypto/node:fs — live here and never leak into core (ADR-0003).
// The store holds only MarkEvents keyed by atom hash, never the atom set
// (ADR-0004); deriving current state is core's `project` fold, not ours.
//
// The composition root passes `rootDir` under per-clone runtime state
// (`.agent-state/reviews/`, gitignored). The filename is the SHA-256 of the
// context string: stable across runs (marks survive sessions) and
// filesystem-safe whatever the branch name or `base..head` range contains.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { MarkEvent, ReviewContext, ReviewStore } from "@clear-diff/core";

function isMarkEvent(value: unknown): value is MarkEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  if (!Number.isFinite(event["ts"]) || typeof event["atomHash"] !== "string") return false;
  switch (event["type"]) {
    case "marked":
      return event["disposition"] === "done" || event["disposition"] === "skipped";
    case "unmarked":
      return true;
    case "commented":
      return typeof event["body"] === "string";
    default:
      return false;
  }
}

export class JsonlReviewStore implements ReviewStore {
  readonly #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  #fileFor(context: ReviewContext): string {
    const name = createHash("sha256").update(context).digest("hex");
    return join(this.#rootDir, `${name}.jsonl`);
  }

  async load(context: ReviewContext): Promise<readonly MarkEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.#fileFor(context), "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw error;
    }
    const events: MarkEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line === "") continue;
      // Throw on a malformed line rather than silently dropping marks: a single
      // local writer with near-atomic appends makes corruption exceptional, so
      // surfacing it beats masking lost history (ADR-0005). Revisit if ADR-0005's
      // reserved event types (session markers, multi-atom) ever land in core.
      const parsed: unknown = JSON.parse(line);
      if (!isMarkEvent(parsed)) throw new Error(`Corrupt event log line: ${line}`);
      events.push(parsed);
    }
    return events;
  }

  async append(context: ReviewContext, event: MarkEvent): Promise<void> {
    await mkdir(this.#rootDir, { recursive: true });
    await appendFile(this.#fileFor(context), `${JSON.stringify(event)}\n`, "utf8");
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}
