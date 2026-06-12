// MarkEvent validation at the persistence boundary (ADR-0005, ADR-0011 §5/§6).
// Shared by every ReviewStore adapter so a fact read back from storage is proven
// well-formed — tier-bearing where required — before it reaches core's `project`
// fold. Wire shape lives at the adapter (ADR-0003); core never validates bytes.
//
// No legacy-missing-author branch (cf. the removed JsonlReviewStore): the committed
// ledger format is new — every fact is author-bearing from its first commit, so a
// missing author is plain corruption, not an older on-disk format to migrate.

import type { MarkEvent } from "@clear-diff/core";

/** A well-formed channel-inferred author (ADR-0011 §5/§6): tier plus optional reviewer label. */
export function isAuthor(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const author = value as Record<string, unknown>;
  const tierOk = author["tier"] === "human" || author["tier"] === "agent";
  const reviewerOk = author["reviewer"] === null || typeof author["reviewer"] === "string";
  return tierOk && reviewerOk;
}

/**
 * A well-formed descriptive `meta` (ADR-0015): absent, or a flat string→string map. Shape only
 * on read-back — bounds are input-hardening at `coerceBatch` (ADR-0015 §3), and `author` is
 * validated independently (below), so `meta` can never carry or override the author tier.
 */
function isOptionalMeta(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}

export function isMarkEvent(value: unknown): value is MarkEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  if (!Number.isFinite(event["ts"])) return false;
  switch (event["type"]) {
    case "marked":
      return (
        typeof event["atomHash"] === "string" &&
        (event["disposition"] === "done" || event["disposition"] === "skipped") &&
        isAuthor(event["author"]) &&
        isOptionalMeta(event["meta"])
      );
    case "unmarked":
      return typeof event["atomHash"] === "string" && isAuthor(event["author"]);
    case "commented":
      return (
        typeof event["atomHash"] === "string" &&
        typeof event["body"] === "string" &&
        isAuthor(event["author"]) &&
        isOptionalMeta(event["meta"])
      );
    case "answered":
      return (
        typeof event["commentId"] === "string" &&
        typeof event["body"] === "string" &&
        isAuthor(event["author"]) &&
        isOptionalMeta(event["meta"])
      );
    case "completed":
      return true;
    // Review-level markers (ADR-0012 §3): no atom, no author tier (the browser channel is
    // implicitly human for a request; `presented` is engine-stamped).
    case "presented":
      return true;
    case "reshape-requested":
      return typeof event["body"] === "string";
    default:
      return false;
  }
}
