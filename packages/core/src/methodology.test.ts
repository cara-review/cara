import { test } from "bun:test";
import assert from "node:assert/strict";
import { METHODOLOGY_VERSION, SYSTEM_METHODOLOGY, buildMethodology } from "./methodology.ts";
import type { ReviewInstructions } from "./ports.ts";

test("METHODOLOGY_VERSION is a positive integer (stamps the atoms response)", () => {
  assert.equal(Number.isInteger(METHODOLOGY_VERSION), true);
  assert.equal(METHODOLOGY_VERSION >= 1, true);
});

test("SYSTEM_METHODOLOGY carries the vocabulary and never leaks internal terms to the user", () => {
  assert.match(SYSTEM_METHODOLOGY, /Chapters/);
  assert.match(SYSTEM_METHODOLOGY, /Sections/);
  // the rule itself names atom/hunk, but only to forbid surfacing them
  assert.match(SYSTEM_METHODOLOGY, /never expose internal words/);
});

test("METHODOLOGY_VERSION is 4 (findings-as-comments-first + the deletion question)", () => {
  assert.equal(METHODOLOGY_VERSION, 4);
});

test("SYSTEM_METHODOLOGY makes findings-as-comments-first a hard rule", () => {
  assert.match(SYSTEM_METHODOLOGY, /A FINDING THAT IS NOT A COMMENT DOES NOT EXIST/);
  assert.match(SYSTEM_METHODOLOGY, /Comment first, narrate after/);
});

test("SYSTEM_METHODOLOGY asks the deletion question, with the file.lock example", () => {
  assert.match(SYSTEM_METHODOLOGY, /what guarantee did/);
  assert.match(SYSTEM_METHODOLOGY, /file\.lock\(\)/);
});

test("SYSTEM_METHODOLOGY mandates a two-stage review with a seams pass over interactions and absences", () => {
  assert.match(SYSTEM_METHODOLOGY, /per-change sweep/);
  assert.match(SYSTEM_METHODOLOGY, /seams pass \(MANDATORY/);
  assert.match(SYSTEM_METHODOLOGY, /Interactions/);
  assert.match(SYSTEM_METHODOLOGY, /Propagations/);
  assert.match(SYSTEM_METHODOLOGY, /Symmetric surfaces/);
  assert.match(SYSTEM_METHODOLOGY, /hunt ABSENCES/);
  // the accounting invariant — every seam finding still lands as a comment on a change
  assert.match(SYSTEM_METHODOLOGY, /Anchor every seam finding as a comment on the nearest relevant change/);
});

test("SYSTEM_METHODOLOGY sizes by cognitive load with a homogeneous-run exception, not a chapter count", () => {
  assert.match(SYSTEM_METHODOLOGY, /cognitive load/);
  assert.match(SYSTEM_METHODOLOGY, /homogeneous runs/);
  assert.match(SYSTEM_METHODOLOGY, /Never\s+fragment repetition/);
  // the old count-based rule and the "optional summary" line are gone
  assert.doesNotMatch(SYSTEM_METHODOLOGY, /2.5 chapters/);
  assert.doesNotMatch(SYSTEM_METHODOLOGY, /optional one-line aid/);
});

test("SYSTEM_METHODOLOGY states summaries are required, not optional", () => {
  assert.match(SYSTEM_METHODOLOGY, /one-line summary — it is required, not optional/);
});

test("buildMethodology with no guidance is exactly the system text", () => {
  const none: ReviewInstructions = { personal: null, project: null };
  assert.equal(buildMethodology(none), SYSTEM_METHODOLOGY);
});

test("buildMethodology merges project then personal instructions, in that order, trimmed", () => {
  const instructions: ReviewInstructions = { personal: "  be terse  ", project: "  focus on api  " };
  const merged = buildMethodology(instructions);
  assert.equal(
    merged,
    [
      SYSTEM_METHODOLOGY,
      "Project instructions:\nfocus on api",
      "Personal instructions:\nbe terse",
    ].join("\n\n"),
  );
  // project precedes personal
  assert.ok(merged.indexOf("Project instructions") < merged.indexOf("Personal instructions"));
});

test("buildMethodology includes only the supplied instruction layers", () => {
  assert.equal(
    buildMethodology({ personal: null, project: "p" }),
    `${SYSTEM_METHODOLOGY}\n\nProject instructions:\np`,
  );
  assert.equal(
    buildMethodology({ personal: "x", project: null }),
    `${SYSTEM_METHODOLOGY}\n\nPersonal instructions:\nx`,
  );
});
