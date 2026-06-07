// The hot-path keyboard model. `keyToAction` is the pure, unit-tested mapping; `installKeyboard`
// wires one document-level listener that suppresses while typing and dispatches the action.
// `⌘K`/`Ctrl+K` toggles the command palette; other chords are left untouched. `DIFF_ACTIONS` is the
// single source of truth for every hot-path action's title, primary key, and dispatch — shared with
// the palette. Each action runs against a `{ store, surface }` context, so store-backed actions and
// the surface-backed side-by-side toggle live side by side in one table.

import type { AppStore } from "../store.ts";
import type { CommandPalette } from "./command-palette.ts";
import type { DiffSurface } from "./diff-surface.ts";
import { markSectionDone, moveFocus, skipSection } from "./controller.ts";
import { dispatchMark } from "./toast.ts";

export type DiffAction = "next" | "prev" | "done" | "skip" | "sideBySide";

/** What a hot-path action can act on: the review store and the diff surface. */
export interface DiffActionContext {
  readonly store: AppStore;
  readonly surface: DiffSurface;
}

export interface DiffActionSpec {
  readonly id: DiffAction;
  readonly title: string;
  /** The primary key shown as the palette hint; `keyToAction` adds aliases (arrows, upper case). */
  readonly key: string;
  run(context: DiffActionContext): void;
}

/** Every hot-path action, named once. Both the keyboard handler and the palette read this. */
export const DIFF_ACTIONS: readonly DiffActionSpec[] = [
  { id: "next", title: "Next section", key: "j", run: ({ store }) => moveFocus(store, "next") },
  { id: "prev", title: "Previous section", key: "k", run: ({ store }) => moveFocus(store, "prev") },
  {
    id: "done",
    title: "Mark section done",
    key: "d",
    run: ({ store }) => dispatchMark("Couldn’t mark this section reviewed.", () => markSectionDone(store)),
  },
  { id: "skip", title: "Skip section", key: "s", run: ({ store }) => dispatchMark("Couldn’t skip this section.", () => skipSection(store)) },
  { id: "sideBySide", title: "Toggle side-by-side view", key: "v", run: ({ surface }) => surface.toggleSideBySide() },
];

const ACTION_BY_ID = new Map(DIFF_ACTIONS.map((action) => [action.id, action]));

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
    case "v":
    case "V":
      return "sideBySide";
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
export function installKeyboard(store: AppStore, palette: CommandPalette, surface: DiffSurface): () => void {
  const handler = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === "k" || event.key === "K")) {
      event.preventDefault();
      palette.toggle();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextEntry(event.target)) return;
    const action = keyToAction(event.key);
    if (action === null) return;
    event.preventDefault();
    ACTION_BY_ID.get(action)?.run({ store, surface });
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}
