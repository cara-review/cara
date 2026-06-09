// Header: brand · review context · headline progress · ⌘K + Done. Progress and the
// Done state read from `snapshot.progress` (canonical master list, ADR-0004). The
// context string is shown verbatim — the UI never parses or reformats refs (the
// backend owns that; reformatting here would leak adapter concepts into the UI).

import { el } from "../dom.ts";
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
  const right = el("div", { class: "header__right" }, [palette, doneButton(state, store)]);

  return el("header", { class: "header" }, [left, right]);
}

function progress(progress: ReviewProgress): HTMLElement {
  const { total, addressed, unaddressed } = progress;
  const fraction = total === 0 ? 0 : addressed / total;
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
    el("span", { class: "progress__label", text: `${unaddressed} of ${total} changes left` }),
  ]);
}

/**
 * "Done reviewing" button (ADR-0011 §4): enabled once every change is accounted for;
 * signals the server that the human has finished — flips `dispatch --wait` to done.
 * The egress (comment-file export) lives in the porcelain, not the UI.
 */
function doneButton(state: AppState, store: AppStore): HTMLElement {
  const snap = state.snapshot;
  const ready = snap !== null && snap.progress.unaddressed === 0 && !snap.completed;
  const alreadyDone = snap?.completed === true;

  if (alreadyDone) {
    return el("button", {
      class: "go go--done",
      text: "✓ Done",
      title: "Review marked complete",
      attrs: { disabled: "" },
    });
  }

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
