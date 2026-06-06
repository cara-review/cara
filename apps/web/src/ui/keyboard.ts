// The hot-path keyboard model. `keyToAction` is the pure, unit-tested mapping; `installKeyboard`
// wires one document-level listener that suppresses while typing and dispatches to the controller.
// Chords (meta/ctrl/alt) are left untouched for the command palette and pane toggles (later).

import type { AppStore } from "../store.ts";
import { markSectionDone, moveFocus, skipSection } from "./controller.ts";

export type DiffAction = "next" | "prev" | "done" | "skip";

/** Map a `KeyboardEvent.key` to a hot-path action, or null if unbound. */
export function keyToAction(key: string): DiffAction | null {
  switch (key) {
    case "j":
    case "ArrowDown":
      return "next";
    case "k":
    case "ArrowUp":
      return "prev";
    case "d":
    case "D":
      return "done";
    case "s":
    case "S":
      return "skip";
    default:
      return null;
  }
}

/** True when focus is in a text-entry surface, where hot-keys must yield to typing. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/** Install the hot-path listener on `document`. Returns a disposer. */
export function installKeyboard(store: AppStore): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextEntry(event.target)) return;
    const action = keyToAction(event.key);
    if (action === null) return;
    event.preventDefault();
    switch (action) {
      case "next":
        moveFocus(store, "next");
        break;
      case "prev":
        moveFocus(store, "prev");
        break;
      case "done":
        void markSectionDone(store);
        break;
      case "skip":
        void skipSection(store);
        break;
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}
