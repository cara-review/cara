// Whole-window states that stand in for the 3-pane grid: the calm loading state
// while the backend reads the diff and proposes structure, a friendly empty-diff
// state, and connection failures. Returns null when the grid should be shown.

import { el } from "../dom.ts";
import type { AppState } from "../store.ts";

type OverlayKind = "loading" | "empty" | "closed" | "error";

function overlayKind(state: AppState): OverlayKind | null {
  if (state.connection === "error") return "error";
  if (state.connection === "closed") return "closed";
  if (state.error !== null) return "error"; // open() rejected — surface it, don't spin on loading
  if (state.snapshot === null) return "loading";
  if (state.snapshot.review.masterList.length === 0) return "empty";
  return null;
}

export function overlay(state: AppState): HTMLElement | null {
  const kind = overlayKind(state);
  if (kind === null) return null;

  const content: Record<OverlayKind, { title: string; detail: string }> = {
    loading: { title: "Reading the diff…", detail: "Proposing a structure for this review." },
    empty: { title: "Nothing to review", detail: "There are no changes in this diff." },
    closed: { title: "Disconnected", detail: "The clear-diff backend closed the connection." },
    error: { title: "Connection failed", detail: state.error ?? "Could not reach the backend." },
  };
  const { title, detail } = content[kind];

  return el("div", { class: `overlay overlay--${kind}` }, [
    kind === "loading" && el("div", { class: "spinner", attrs: { "aria-hidden": "true" } }),
    el("h1", { class: "overlay__title", text: title }),
    el("p", { class: "overlay__detail", text: detail }),
  ]);
}
