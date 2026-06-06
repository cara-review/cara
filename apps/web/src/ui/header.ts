// Header: brand · review context · headline progress · ⌘K + Go. Progress and the
// Go state read from `snapshot.progress` (canonical master list, ADR-0004). The
// context string is shown verbatim — the UI never parses or reformats refs (the
// backend owns that; reformatting here would leak adapter concepts into the UI).

import { el } from "../dom.ts";
import type { ReviewProgress } from "../protocol.ts";
import type { AppState } from "../store.ts";

export function header(state: AppState): HTMLElement {
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
  const right = el("div", { class: "header__right" }, [palette, goButton(state)]);

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

function goButton(state: AppState): HTMLElement {
  const ready = state.snapshot !== null && state.snapshot.progress.unaddressed === 0;
  return el("button", {
    class: ready ? "go go--ready" : "go",
    text: ready ? "Go" : "Review incomplete",
    title: ready ? "Dispatch comments" : "Account for every Section first",
    attrs: ready ? {} : { disabled: "" },
  });
}

function divider(): HTMLElement {
  return el("span", { class: "header__divider", attrs: { "aria-hidden": "true" } });
}
