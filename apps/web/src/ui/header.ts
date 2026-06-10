// Header: brand · review context · headline progress · ⌘K + Reshape + Done.
// Progress and the Done state read from `snapshot.progress` (canonical master list,
// ADR-0004). Completion uses `accounted` (ADR-0012 §f): a comment-only atom counts as
// gap-closed. The context string is shown verbatim — the UI never parses or reformats
// refs (the backend owns that; reformatting would leak adapter concepts into the UI).

import { el } from "../dom.ts";
import { openReshapeDialog } from "./reshape.ts";
import type { ReviewProgress } from "../protocol.ts";
import type { AppState, AppStore } from "../store.ts";

export function header(state: AppState, store: AppStore): HTMLElement {
  const brand = el("div", { class: "brand", text: "clear-diff" });
  const left = el("div", { class: "header__left" }, [brand]);

  const snapshot = state.snapshot;
  if (snapshot !== null) {
    left.append(
      divider(),
      el("div", { class: "context", text: snapshot.context, title: snapshot.context }),
      divider(),
      progress(snapshot.progress),
    );
  }

  const palette = el("div", { class: "kbd-hint", title: "Command palette" }, [
    el("kbd", { text: "⌘" }),
    el("kbd", { text: "K" }),
  ]);
  const right = el("div", { class: "header__right" }, [
    palette,
    reshapeControl(state, store),
    doneButton(state, store),
  ]);

  return el("header", { class: "header" }, [left, right]);
}

/**
 * "Reshape…" button — or "Reshape asked" pill when a request is pending.
 * Only shown when a review is loaded.
 */
function reshapeControl(state: AppState, store: AppStore): HTMLElement | null {
  const snap = state.snapshot;
  if (snap === null) return null;

  if (snap.pendingReshape !== null) {
    // Human-authored body displayed as title (tooltip) — escaped by attrs.
    return el("span", {
      class: "reshape-pending",
      text: "Reshape asked — waiting for agent",
      title: `Pending: "${snap.pendingReshape}"`,
    });
  }

  return el("button", {
    class: "go reshape-btn",
    text: "Reshape…",
    title: "Ask the agent to reorganise this review",
    onClick: () => openReshapeDialog(store),
  });
}

function progress(p: ReviewProgress): HTMLElement {
  const { total, addressed, accounted } = p;
  // Meter fill: fraction of atoms that have a disposition (the stricter definition).
  const fraction = total === 0 ? 0 : addressed / total;
  // Label: "N of M changes left" uses accounted so a comment-only atom counts as closed.
  const remaining = total - accounted;

  const meterFill = el("div", { class: "meter__fill" });
  meterFill.style.width = `${Math.round(fraction * 100)}%`;
  const meter = el(
    "div",
    {
      class: "meter",
      attrs: {
        role: "progressbar",
        "aria-valuenow": String(addressed),
        "aria-valuemin": "0",
        "aria-valuemax": String(total),
      },
    },
    [meterFill],
  );
  return el("div", { class: "progress" }, [
    meter,
    el("span", { class: "progress__label", text: `${remaining} of ${total} changes left` }),
  ]);
}

/**
 * "Done reviewing" button (ADR-0011 §4, ADR-0012 §f): enabled once every change is
 * accounted for (disposition OR comment). Signals the server that the human has finished
 * — flips `dispatch --wait` to done. The egress (comment-file export) lives in the
 * porcelain, not the UI.
 */
function doneButton(state: AppState, store: AppStore): HTMLElement {
  const snap = state.snapshot;
  if (snap === null) {
    return el("button", { class: "go", text: "Review incomplete", title: "Account for every Section first", attrs: { disabled: "" } });
  }

  if (snap.completed) {
    return el("button", { class: "go go--done", text: "✓ Done", title: "Review marked complete", attrs: { disabled: "" } });
  }

  // Gap-closed: accounted covers dispositions + comment-only atoms (ADR-0012 §f).
  const ready = snap.progress.accounted >= snap.progress.total;

  const button = el("button", {
    class: ready ? "go go--ready" : "go",
    text: ready ? "Done reviewing" : "Review incomplete",
    title: ready ? "Mark review complete" : "Account for every Section first",
    attrs: ready ? {} : { disabled: "" },
  });
  if (!ready) return button;
  button.addEventListener("click", () => {
    button.disabled = true;
    void store
      .markComplete()
      .then(() => {
        button.textContent = "✓ Done";
        button.classList.add("go--done");
      })
      .catch(() => {
        button.textContent = "Done reviewing (failed)";
        button.disabled = false;
      });
  });
  return button;
}

function divider(): HTMLElement {
  return el("span", { class: "header__divider", attrs: { "aria-hidden": "true" } });
}
