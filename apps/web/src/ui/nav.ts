// Nav pane: the two-level structure (Chapters → Sections), the most-scanned surface.
// Each Section row shows its mark glyph, title, and change count; counts and state
// roll up from the canonical marks (selectors.navTree). The active Section is
// highlighted and chapters expand/collapse. Driving focus = store.setActiveSection.

import { el, fill } from "../dom.ts";
import { navTree, type ChapterNode, type SectionNode } from "../selectors.ts";
import type { AppState, AppStore } from "../store.ts";
import { markGlyph } from "./glyph.ts";

/** Render the nav tree into a stable host element (rebuilds its children each call). */
export function renderNav(host: HTMLElement, state: AppState, store: AppStore): void {
  const label = el("div", { class: "nav__label", text: "Structure" });
  const tree = el("div", { class: "nav__tree", attrs: { role: "tree" } });

  if (state.snapshot !== null) {
    navTree(state.snapshot).forEach((chapter, index) => {
      tree.append(chapterRow(chapter, index, state, store));
      if (state.expandedChapters.has(index)) {
        for (const [sectionIndex, section] of chapter.sections.entries()) {
          tree.append(sectionRow(section, index, sectionIndex, state, store));
        }
      }
    });
  }

  fill(host, label, tree);
}

function chapterRow(
  chapter: ChapterNode,
  index: number,
  state: AppState,
  store: AppStore,
): HTMLElement {
  const expanded = state.expandedChapters.has(index);
  const complete = chapter.sections.length > 0 && chapter.sections.every((s) => s.state !== "unreviewed");
  return el(
    "button",
    {
      class: `chapter${complete ? " chapter--done" : ""}`,
      title: chapter.summary ?? chapter.title,
      attrs: { role: "treeitem", "aria-expanded": String(expanded) },
      onClick: () => store.toggleChapter(index),
    },
    [
      el("span", { class: `chevron${expanded ? " chevron--open" : ""}`, text: "▸", attrs: { "aria-hidden": "true" } }),
      el("span", { class: "chapter__title", text: chapter.title }),
    ],
  );
}

function sectionRow(
  section: SectionNode,
  chapter: number,
  sectionIndex: number,
  state: AppState,
  store: AppStore,
): HTMLElement {
  const active =
    state.activeSection?.chapter === chapter && state.activeSection.section === sectionIndex;
  return el(
    "button",
    {
      class: `section${active ? " section--active" : ""}`,
      attrs: active ? { role: "treeitem", "aria-current": "true" } : { role: "treeitem" },
      onClick: () => store.setActiveSection({ chapter, section: sectionIndex }),
    },
    [
      markGlyph(section.state),
      el("span", { class: "section__title", text: section.title }),
      el("span", { class: "section__count", text: String(section.total) }),
    ],
  );
}
