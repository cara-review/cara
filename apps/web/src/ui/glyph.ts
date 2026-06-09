// The mark-state glyph and agent tier badge, shared by nav rows and the diff section
// header. State is conveyed by shape + label, never colour alone (accessibility):
// an empty ring (not reviewed), a filled tick (reviewed), a dashed ring (skipped).
// The agent tier badge is a separate chip shown when all marks in a section are
// agent-authored — distinct from the human mark glyph.

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

/**
 * Tier badge shown when every mark in a section is agent-authored.
 * `badge.reviewer` is the reviewer label (e.g. "security"), or null when unlabelled
 * or labels are mixed. A single human mark in the section removes the badge.
 */
export function agentBadge(badge: { readonly reviewer: string | null }): HTMLElement {
  const label = badge.reviewer !== null ? badge.reviewer : "agent";
  return el("span", {
    class: "badge badge--agent",
    text: label,
    title: `Agent-reviewed${badge.reviewer !== null ? ` (${label})` : ""}`,
    attrs: { "aria-label": `Agent mark: ${label}` },
  });
}
