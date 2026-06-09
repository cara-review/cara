// The review methodology, owned by core (ADR-0011, TN-26-026 decision #10).
//
// clear-diff no longer carries its own grouping LLM; the calling agent groups and
// prioritises. The methodology it must follow is therefore canonical text emitted by
// core — the single source surfaced both as the `atoms` response and by the
// `instructions` verb, version-locked to the `present` grouping schema so the rules
// and the schema can never drift apart. It is adapter-neutral: no CLI verb names, no
// LLM or transport concepts — only the domain vocabulary of Chapters and Sections.

import type { ReviewInstructions } from "./ports.ts";

/** Bumped whenever the grouping schema or these rules change. Stamps the `atoms` response. */
export const METHODOLOGY_VERSION = 1;

/** The canonical grouping rules + vocabulary every reviewing agent follows. */
export const SYSTEM_METHODOLOGY: string = [
  "You organise a code review. You are given the full set of changes — each an",
  "indivisible unit with a stable id, its file path, and its diff — and you arrange",
  "them into a navigable structure for the reviewer:",
  "",
  "- Chapters: major tranches of intent, ordered by importance, most important first.",
  "  Importance, high to low: (1) interfaces / API / types / boundaries and ports;",
  "  (2) key behaviour and logic; (3) wiring and composition; (4) tests, docs, config,",
  "  and churn — these come LAST and should be merged, never spread across many chapters.",
  "- Sections: curated groups of related change within a chapter, ordered by relevance",
  "  — group by theme and intent, not by file or by position in the diff.",
  "",
  "Stay lean: aim for about 2–5 chapters with a few sections each. Never one chapter or",
  "section per file; merge trivia. Titles are a tight noun phrase — a few words, no file",
  "lists. Summaries are an optional one-line aid.",
  "",
  "Reference every change by its exact id, drawn only from the supplied set. You may",
  "arrange and describe, never define or alter the change: never invent, omit, or",
  "duplicate one (the engine repairs any grouping back to the canonical set regardless).",
  "Titles and summaries are display aids, never a replacement for the diff. Speak in",
  'terms of Chapters and Sections; never expose internal words like "atom" or "hunk".',
].join("\n");

/**
 * Merge the canonical methodology with the project (CLEAR_DIFF.md) and personal
 * reviewer guidance, in that precedence order. Pure text assembly — the version is
 * carried alongside as `METHODOLOGY_VERSION`, never interpreted from the prose.
 */
export function buildMethodology(instructions: ReviewInstructions): string {
  const parts: string[] = [SYSTEM_METHODOLOGY];
  if (instructions.project) parts.push(`Project reviewer guidance:\n${instructions.project.trim()}`);
  if (instructions.personal) parts.push(`Personal reviewer guidance:\n${instructions.personal.trim()}`);
  return parts.join("\n\n");
}
