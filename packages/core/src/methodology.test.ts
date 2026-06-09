import { test } from "bun:test";
import assert from "node:assert/strict";
import { METHODOLOGY_VERSION, SYSTEM_METHODOLOGY, buildMethodology } from "./methodology.ts";
import type { ReviewInstructions } from "./ports.ts";

test("METHODOLOGY_VERSION is a positive integer (stamps the atoms response)", () => {
  assert.equal(Number.isInteger(METHODOLOGY_VERSION), true);
  assert.equal(METHODOLOGY_VERSION >= 1, true);
});

test("SYSTEM_METHODOLOGY carries the vocabulary and never leaks internal terms to the reviewer", () => {
  assert.match(SYSTEM_METHODOLOGY, /Chapters/);
  assert.match(SYSTEM_METHODOLOGY, /Sections/);
  // the rule itself names atom/hunk, but only to forbid surfacing them
  assert.match(SYSTEM_METHODOLOGY, /never expose internal words/);
});

test("buildMethodology with no guidance is exactly the system text", () => {
  const none: ReviewInstructions = { personal: null, project: null };
  assert.equal(buildMethodology(none), SYSTEM_METHODOLOGY);
});

test("buildMethodology merges project then personal guidance, in that order, trimmed", () => {
  const instructions: ReviewInstructions = { personal: "  be terse  ", project: "  focus on api  " };
  const merged = buildMethodology(instructions);
  assert.equal(
    merged,
    [
      SYSTEM_METHODOLOGY,
      "Project reviewer guidance:\nfocus on api",
      "Personal reviewer guidance:\nbe terse",
    ].join("\n\n"),
  );
  // project precedes personal
  assert.ok(merged.indexOf("Project reviewer guidance") < merged.indexOf("Personal reviewer guidance"));
});

test("buildMethodology includes only the supplied guidance layers", () => {
  assert.equal(
    buildMethodology({ personal: null, project: "p" }),
    `${SYSTEM_METHODOLOGY}\n\nProject reviewer guidance:\np`,
  );
  assert.equal(
    buildMethodology({ personal: "x", project: null }),
    `${SYSTEM_METHODOLOGY}\n\nPersonal reviewer guidance:\nx`,
  );
});
