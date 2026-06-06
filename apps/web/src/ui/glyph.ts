// The mark-state glyph, shared by the nav rows and the diff section header. State is
// conveyed by shape + label, never colour alone (accessibility): an empty ring
// (not reviewed), a filled tick (reviewed), a dashed ring (skipped).

import { el } from "../dom.ts";
import type { SectionState } from "../selectors.ts";

const LABEL: Record<SectionState, string> = {
  unreviewed: "Not reviewed",
  done: "Reviewed",
  skipped: "Skipped",
};

const SYMBOL: Record<SectionState, string> = {
  unreviewed: "",
  done: "✓",
  skipped: "",
};

export function markGlyph(state: SectionState): HTMLElement {
  return el("span", {
    class: `glyph glyph--${state}`,
    text: SYMBOL[state],
    title: LABEL[state],
    attrs: { role: "img", "aria-label": LABEL[state] },
  });
}
