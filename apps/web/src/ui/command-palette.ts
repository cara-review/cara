// ⌘K command palette: a keyboard-driven overlay over the actions the review loop already
// exposes. It never invents behaviour — every command maps onto a wired controller/store
// call. The pure parts (buildCommands, fuzzyScore, filterCommands) are unit-tested; the
// DOM controller (createCommandPalette) owns one overlay on document.body. Agent-supplied
// Chapter/Section titles are untrusted text, escaped by construction via dom.el (ADR-0004).

import { el, fill } from "../dom.ts";
import { navTree } from "../selectors.ts";
import type { AppState, AppStore } from "../store.ts";
import { focusSection } from "./controller.ts";
import type { DiffSurface } from "./diff-surface.ts";
import { DIFF_ACTIONS } from "./keyboard.ts";
import { openReshapeDialog } from "./reshape.ts";

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  run(): void;
}

/** Build the command list for the current state. Static actions need an active review. */
export function buildCommands(state: AppState, store: AppStore, surface: DiffSurface): Command[] {
  const snapshot = state.snapshot;
  if (snapshot === null) return [];

  const commands: Command[] = DIFF_ACTIONS.map((action) => ({
    id: action.id,
    title: action.title,
    hint: action.key,
    run: () => action.run({ store, surface }),
  }));

  // Reshape command — hidden when a request is already pending (no point queuing another).
  if (snapshot.pendingReshape === null) {
    commands.push({ id: "reshape", title: "Reshape this review…", run: () => openReshapeDialog(store) });
  }

  navTree(snapshot).forEach((chapter, chapterIndex) => {
    chapter.sections.forEach((section, sectionIndex) => {
      commands.push({
        id: `jump:${chapterIndex}:${sectionIndex}`,
        title: `Jump to ${chapter.title} › ${section.title}`,
        run: () => focusSection(store, { chapter: chapterIndex, section: sectionIndex }),
      });
    });
  });

  return commands;
}

/**
 * Case-insensitive subsequence match. Returns a score (higher = better) or null for no
 * match. Contiguous runs and an early first hit score higher, so the tightest matches sort
 * first. An empty query matches everything with a neutral score.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const haystack = text.toLowerCase();

  let score = 0;
  let from = 0;
  let lastIndex = -2;
  for (const char of q) {
    const index = haystack.indexOf(char, from);
    if (index === -1) return null;
    score += index === lastIndex + 1 ? 3 : 1; // reward contiguity
    if (index === 0) score += 2; // reward a start-of-string hit
    lastIndex = index;
    from = index + 1;
  }
  return score;
}

/** Filter to matching commands, ranked by score (best first); preserves order on ties. */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  return commands
    .map((command, index) => ({ command, index, score: fuzzyScore(query, command.title) }))
    .filter((entry): entry is { command: Command; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

export interface CommandPalette {
  open(): void;
  close(): void;
  toggle(): void;
}

/** Create the palette overlay (hidden) inside `mount` and return its controls. */
export function createCommandPalette(mount: HTMLElement, store: AppStore, surface: DiffSurface): CommandPalette {
  let commands: readonly Command[] = [];
  let filtered: Command[] = [];
  let selected = 0;

  const input = el("input", {
    class: "palette__input",
    attrs: { type: "text", placeholder: "Type a command…", "aria-label": "Command palette" },
  });
  const list = el("div", { class: "palette__list", attrs: { role: "listbox" } });
  const panel = el("div", { class: "palette__panel" }, [input, list]);
  const backdrop = el("div", { class: "palette", attrs: { role: "dialog", "aria-modal": "true" } }, [panel]);
  backdrop.hidden = true;
  mount.append(backdrop);

  function renderList(): void {
    if (filtered.length === 0) {
      fill(list, el("div", { class: "palette__empty", text: "No matching commands" }));
      return;
    }
    fill(
      list,
      ...filtered.map((command, index) =>
        el(
          "button",
          {
            class: `palette__item${index === selected ? " palette__item--active" : ""}`,
            attrs: { role: "option", "aria-selected": String(index === selected) },
            onClick: () => choose(command),
          },
          [
            el("span", { class: "palette__title", text: command.title }),
            command.hint !== undefined ? el("kbd", { text: command.hint }) : null,
          ],
        ),
      ),
    );
  }

  function refilter(): void {
    filtered = filterCommands(commands, input.value);
    selected = 0;
    renderList();
  }

  function move(delta: number): void {
    if (filtered.length === 0) return;
    selected = (selected + delta + filtered.length) % filtered.length;
    renderList();
  }

  function choose(command: Command): void {
    close();
    command.run();
  }

  function open(): void {
    commands = buildCommands(store.getState(), store, surface);
    if (commands.length === 0) return; // nothing to act on yet
    backdrop.hidden = false;
    input.value = "";
    refilter();
    input.focus();
  }

  function close(): void {
    backdrop.hidden = true;
  }

  function toggle(): void {
    if (backdrop.hidden) open();
    else close();
  }

  input.addEventListener("input", refilter);
  input.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter": {
        event.preventDefault();
        const command = filtered[selected];
        if (command !== undefined) choose(command);
        break;
      }
      case "Escape":
        event.preventDefault();
        close();
        break;
    }
  });
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });

  return { open, close, toggle };
}
