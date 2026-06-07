/**
 * An error whose message is curated and safe to show the reviewer verbatim — it
 * carries no system internals (git stderr, fs paths, SDK response shapes). The
 * transport surfaces a UserFacingError's message to the UI; every other error is
 * masked to a generic "Internal error." (see dispatch.ts). Adapters raise it to
 * turn a known operational failure — the agent timing out or being unavailable —
 * into a clear, actionable message instead of a silent hang or an opaque mask.
 */
export class UserFacingError extends Error {}
