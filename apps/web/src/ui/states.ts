// Whole-window states that stand in for the 3-pane grid when there is nothing to
// show yet: connecting / reading the diff, reconnecting or disconnected before the
// first snapshot, a failed open, and a friendly empty-diff state. Once a snapshot
// exists the grid stays up and connection trouble is surfaced non-blockingly by the
// status bar — the reviewer keeps their place while the transport reconnects.
// Returns null when the grid should be shown.

import { el } from "../dom.ts";
import type { AppState } from "../store.ts";

type OverlayKind = "connecting" | "loading" | "reconnecting" | "disconnected" | "error" | "empty";

const SPINNING: ReadonlySet<OverlayKind> = new Set(["connecting", "loading", "reconnecting"]);

function overlayKind(state: AppState): OverlayKind | null {
  if (state.snapshot !== null) {
    return state.snapshot.review.masterList.length === 0 ? "empty" : null;
  }
  // No snapshot yet — the whole window reports connection/loading status.
  if (state.error !== null) return "error"; // snapshot query rejected — surface it, don't spin
  switch (state.connection) {
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "disconnected";
    case "open":
      return "loading"; // socket up, awaiting the snapshot query
    case "connecting":
      return "connecting";
  }
}

export function overlay(state: AppState): HTMLElement | null {
  const kind = overlayKind(state);
  if (kind === null) return null;

  const content: Record<OverlayKind, { title: string; detail: string }> = {
    connecting: { title: "Connecting…", detail: "Reaching the clear-diff backend." },
    loading: { title: "Loading review…", detail: "Fetching the review snapshot from the backend." },
    reconnecting: { title: "Reconnecting…", detail: "Lost the backend — trying to restore the connection." },
    disconnected: { title: "Disconnected", detail: "Couldn't reach the backend. Restart clear-diff to continue." },
    error: { title: "Something went wrong", detail: state.error ?? "Could not reach the backend." },
    empty: { title: "Nothing to review", detail: "There are no changes in this diff." },
  };
  const { title, detail } = content[kind];

  return el("div", { class: `overlay overlay--${kind}` }, [
    SPINNING.has(kind) && el("div", { class: "spinner", attrs: { "aria-hidden": "true" } }),
    el("h1", { class: "overlay__title", text: title }),
    el("p", { class: "overlay__detail", text: detail }),
  ]);
}
