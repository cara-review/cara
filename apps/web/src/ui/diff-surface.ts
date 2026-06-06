// The diff surface (#12): renders the focused Section's evidence into the shell's stable
// `[data-diff-surface]` mount as change-block / gap / change-block across files. Marks are
// canonical (read back from the snapshot); the agent never authors the diff (ADR-0004), so
// every line here is git-verbatim and set via textContent (no markup). DOM-only — the
// structural and marking logic it leans on (diff-model, controller) is pure and tested.

import "./diff-surface.css";
import { el, fill } from "../dom.ts";
import { marksMap } from "../selectors.ts";
import type { Atom } from "../protocol.ts";
import type { AppState, AppStore } from "../store.ts";
import { sectionAt } from "../navigation.ts";
import { diffModel, numberedLines, type FileGroup, type Gap } from "./diff-model.ts";
import { markSectionDone, skipSection, toggleBlock } from "./controller.ts";

export interface DiffSurface {
  render(state: AppState): void;
}

/** Create the surface bound to a mount + store. Expansion is ephemeral view state held here. */
export function createDiffSurface(mount: HTMLElement, store: AppStore): DiffSurface {
  const expanded = new Map<string, readonly string[]>();

  function rerender(): void {
    render(store.getState());
  }

  async function expand(key: string, gap: Gap, path: string): Promise<void> {
    const { text } = await store.readFile(path, "head");
    const lines = text === null ? [] : text.split("\n");
    expanded.set(key, lines.slice(gap.headStart - 1, gap.headEnd));
    rerender();
  }

  function gapRegion(group: FileGroup, atom: Atom, gap: Gap): readonly Node[] {
    const key = atom.hash; // content-unique (ADR-0002); no path prefix needed
    const lines = expanded.get(key);
    if (lines === undefined) {
      return [
        el("button", {
          class: "gap",
          text: `Expand ${gap.hiddenLines} hidden ${gap.hiddenLines === 1 ? "line" : "lines"}`,
          onClick: () => void expand(key, gap, group.path),
        }),
      ];
    }
    const context = lines.map((text, offset) => contextLine(gap.headStart + offset, text));
    const collapse = el("button", {
      class: "gap gap--open",
      text: "Collapse",
      onClick: () => {
        expanded.delete(key);
        rerender();
      },
    });
    return [...context, collapse];
  }

  function block(group: FileGroup, atom: Atom, headStart: number, reviewed: boolean): HTMLElement {
    const tick = el("button", {
      class: `tick${reviewed ? " tick--on" : ""}`,
      text: reviewed ? "✓ Reviewed" : "Mark reviewed",
      attrs: { "aria-pressed": String(reviewed) },
      onClick: () => void toggleBlock(store, atom),
    });
    const location = el("button", {
      class: "block__loc",
      text: locationLabel(atom),
      title: "Open in editor",
      onClick: () => void store.openInEditor(group.path, headStart),
    });
    const bar = el("div", { class: "block__bar" }, [location, tick]);
    const lines = el("div", { class: "lines" }, numberedLines(atom).map(changeLine));
    return el("div", { class: `block${reviewed ? " block--reviewed" : ""}` }, [bar, lines]);
  }

  function fileGroup(group: FileGroup, marked: ReturnType<typeof marksMap>): HTMLElement {
    const head = el("button", {
      class: "file__header",
      title: "Open in editor",
      onClick: () => void store.openInEditor(group.path, group.blocks[0]?.headStart ?? 1),
    }, [
      el("span", { class: "file__path", text: pathLabel(group) }),
      el("span", { class: `file__status file__status--${group.status}`, text: group.status }),
    ]);

    const body = el("div", { class: "file__body" });
    for (const b of group.blocks) {
      if (b.gap !== null) for (const node of gapRegion(group, b.atom, b.gap)) body.append(node);
      body.append(block(group, b.atom, b.headStart, marked.get(b.atom.hash) === "done"));
    }
    return el("section", { class: "file" }, [head, body]);
  }

  function render(state: AppState): void {
    if (state.snapshot === null || state.activeSection === null) {
      mount.replaceChildren();
      return;
    }
    const section = sectionAt(state.snapshot, state.activeSection);
    if (section === null) {
      mount.replaceChildren();
      return;
    }
    if (section.atoms.length === 0) {
      fill(mount, el("p", { class: "surface__empty", text: "No changes in this Section." }));
      return;
    }

    const marked = marksMap(state.snapshot);
    const files = diffModel(section).map((group) => fileGroup(group, marked));
    const actions = el("div", { class: "actionbar" }, [
      el("button", { class: "action action--skip", text: "Skip", onClick: () => void skipSection(store) }),
      el("button", { class: "action action--done", text: "✓ Done & Next", onClick: () => void markSectionDone(store) }),
    ]);
    fill(mount, ...files, actions);
  }

  return { render };
}

/** One diff row: line-number gutter · sign cue (`+`/`-`/space) · verbatim code. */
function lineRow(variant: string, lineNo: number, sign: string, text: string): HTMLElement {
  return el("div", { class: `line line--${variant}` }, [
    el("span", { class: "line__no", text: String(lineNo) }),
    el("span", { class: "line__sign", attrs: { "aria-hidden": "true" }, text: sign }),
    el("code", { class: "line__code", text }),
  ]);
}

function changeLine(line: ReturnType<typeof numberedLines>[number]): HTMLElement {
  return lineRow(line.kind, line.lineNo, line.kind === "added" ? "+" : "-", line.text);
}

function contextLine(lineNo: number, text: string): HTMLElement {
  return lineRow("context", lineNo, " ", text);
}

function pathLabel(group: FileGroup): string {
  return group.status === "renamed" && group.previousPath !== null
    ? `${group.previousPath} → ${group.path}`
    : group.path;
}

function locationLabel(atom: Atom): string {
  const span = atom.newLines > 0 ? `${atom.newStart}–${atom.newStart + atom.newLines - 1}` : `${atom.newStart}`;
  return `Lines ${span}`;
}
