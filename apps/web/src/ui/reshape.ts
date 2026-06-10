// Reshape request dialog (ADR-0012 §3): a centred modal where the human describes how
// they want the review reorganised. On submit the request is recorded via
// store.requestReshape(body); the agent reads it on `dispatch` and re-presents a new
// grouping. The pending state (snapshot.pendingReshape !== null) is shown in the header
// until the agent re-presents, which clears it mechanically.
//
// The body is human-authored plain text — never interpreted as markup, escaped by
// textContent. The modal closes on submit or cancel; clicking the backdrop dismisses too.

import { el } from "../dom.ts";
import type { AppStore } from "../store.ts";

/**
 * Open the Reshape dialog: a centred modal overlay with a textarea and submit button.
 * On submit calls `store.requestReshape(body)` and closes. Idempotent — calling while
 * a dialog is already open replaces it (old one is removed first).
 */
export function openReshapeDialog(store: AppStore): void {
  // Replace any in-progress dialog (discards unsaved text — intentional; only one reshape
  // request can be in flight at a time anyway since the button hides after submit).
  document.querySelector(".reshape-dialog")?.remove();

  const input = el("textarea", {
    class: "reshape-dialog__input",
    attrs: { rows: "4", placeholder: "Describe how you'd like this reorganised…" },
  });

  const accept = el("button", {
    class: "reshape-dialog__accept go go--ready",
    text: "Ask to reshape",
    onClick: () => {
      const body = input.value.trim();
      if (body === "") return; // don't submit empty
      dismiss();
      void store.requestReshape(body);
    },
  });

  const cancel = el("button", {
    class: "reshape-dialog__cancel go",
    text: "Cancel",
    onClick: dismiss,
  });

  const panel = el("div", { class: "reshape-dialog__panel" }, [
    el("h2", { class: "reshape-dialog__title", text: "Reshape this review" }),
    el("p", { class: "reshape-dialog__hint", text: "Describe how you'd like the changes regrouped, filtered, or presented. Your agent will re-present a new grouping." }),
    input,
    el("div", { class: "reshape-dialog__actions" }, [cancel, accept]),
  ]);

  const backdrop = el("div", {
    class: "reshape-dialog",
    attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Reshape review" },
  }, [panel]);

  function dismiss(): void {
    backdrop.remove();
  }

  // Click outside the panel to dismiss.
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) dismiss();
  });

  // Escape to dismiss.
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
  });

  document.body.appendChild(backdrop);
  // Focus asynchronously so the element is in the DOM when focus() runs.
  requestAnimationFrame(() => input.focus());
}
