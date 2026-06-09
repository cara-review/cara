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

/** A well-formed channel-inferred author (ADR-0011 §5/§6): tier plus optional reviewer label. */
function isAuthor(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const author = value as Record<string, unknown>;
  const tierOk = author["tier"] === "human" || author["tier"] === "agent";
  const reviewerOk = author["reviewer"] === null || typeof author["reviewer"] === "string";
  return tierOk && reviewerOk;
}

/** The mutating event types that, pre-pivot, lacked an `author` field (Risk seam #1). */
const AUTHORED_TYPES = new Set(["marked", "unmarked", "commented"]);

function isMarkEvent(value: unknown): value is MarkEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  if (!Number.isFinite(event["ts"])) return false;
  switch (event["type"]) {
    case "marked":
      return (
        typeof event["atomHash"] === "string" &&
        (event["disposition"] === "done" || event["disposition"] === "skipped") &&
        isAuthor(event["author"])
      );
    case "unmarked":
      return typeof event["atomHash"] === "string" && isAuthor(event["author"]);
    case "commented":
      return typeof event["atomHash"] === "string" && typeof event["body"] === "string" && isAuthor(event["author"]);
    case "answered":
      return typeof event["commentId"] === "string" && typeof event["body"] === "string" && isAuthor(event["author"]);
    case "completed":
      return true;
    default:
      return false;
  }
}

/** True when a line is a recognisable pre-pivot event (a known type missing its `author`). */
function isPrePivotEvent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return AUTHORED_TYPES.has(event["type"] as string) && !isAuthor(event["author"]);
}

/** SHA-256 of the context string: a stable, filesystem-safe per-review key (ADR-0005). */
export function contextHash(context: ReviewContext): string {
  return createHash("sha256").update(context).digest("hex");
}

export class JsonlReviewStore implements ReviewStore {
  readonly #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  #fileFor(context: ReviewContext): string {
    return join(this.#rootDir, `${contextHash(context)}.jsonl`);
  }

  async load(context: ReviewContext): Promise<readonly MarkEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.#fileFor(context), "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw error;
    }
    const file = this.#fileFor(context);
    const events: MarkEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line === "") continue;
      // Throw on a malformed line rather than silently dropping marks: a single
      // local writer with near-atomic appends makes corruption exceptional, so
      // surfacing it beats masking lost history (ADR-0005).
      const parsed: unknown = JSON.parse(line);
      if (!isMarkEvent(parsed)) {
        // A pre-pivot log (no channel-inferred author, Risk seam #1) is not corruption
        // — it predates the tier contract. Marks are local, gitignored runtime state, so
        // there is no migration: name the file and tell the user to delete it.
        if (isPrePivotEvent(parsed)) {
          throw new Error(`${file}: incompatible review log (pre-pivot format) — delete it and re-review`);
        }
        throw new Error(`Corrupt event log line: ${line}`);
      }
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
