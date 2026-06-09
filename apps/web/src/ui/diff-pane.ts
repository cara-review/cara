// Diff pane (the hero): the shell renders the sticky Section header (mark glyph +
// title) and the untrusted "AI summary" band; the diff surface itself is #12's, so a
// STABLE `[data-diff-surface]` mount is created once and never touched by the shell
// again (re-rendering it would wipe #12's surface).
//
// The summary is the agent's untrusted overlay (ADR-0004): rendered via renderMarkdown
// (markdown-it + DOMPurify), visually secondary, explicitly labelled — never authoritative.

import { el } from "../dom.ts";
import { marksMap, sectionRollup } from "../selectors.ts";
import type { AppState } from "../store.ts";
import { markGlyph } from "./glyph.ts";
import { renderMarkdown } from "./markdown.ts";

export interface DiffPane {
  readonly node: HTMLElement;
  /** The persistent surface #12 renders evidence into. */
  readonly mount: HTMLElement;
  update(state: AppState): void;
}

export function createDiffPane(): DiffPane {
  const sectionHeader = el("div", { class: "diff__header" });
  const summary = el("div", { class: "summary" });
  const mount = el("div", { class: "diff__surface", attrs: { "data-diff-surface": "" } });
  const node = el("section", { class: "diff" }, [sectionHeader, summary, mount]);

  return {
    node,
    mount,
    update(state) {
      renderHeader(sectionHeader, state);
      renderSummary(summary, state);
    },
  };
}

interface ActiveSection {
  readonly title: string;
  readonly summary: string | null;
  readonly rollup: ReturnType<typeof sectionRollup>;
}

function getActiveSection(state: AppState): ActiveSection | null {
  const path = state.activeSection;
  const snapshot = state.snapshot;
  if (path === null || snapshot === null) return null;
  const section = snapshot.review.chapters[path.chapter]?.sections[path.section];
  if (section === undefined) return null;
  return { title: section.title, summary: section.summary, rollup: sectionRollup(section, marksMap(snapshot)) };
}

function renderHeader(container: HTMLElement, state: AppState): void {
  const current = getActiveSection(state);
  if (current === null) {
    container.replaceChildren();
    return;
  }
  container.replaceChildren(
    markGlyph(current.rollup.state),
    el("h1", { class: "diff__title", text: current.title }),
    el("span", {
      class: "diff__count",
      text: `${current.rollup.addressed}/${current.rollup.total} reviewed`,
    }),
  );
}

function renderSummary(container: HTMLElement, state: AppState): void {
  const current = getActiveSection(state);
  if (current === null || current.summary === null) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const body = el("div", { class: "summary__body" });
  // Summary is untrusted agent overlay (ADR-0004): rendered via renderMarkdown.
  body.innerHTML = renderMarkdown(current.summary);
  container.replaceChildren(el("span", { class: "summary__label", text: "AI summary" }), body);
}
