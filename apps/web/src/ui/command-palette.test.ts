import { test } from "bun:test";
import assert from "node:assert/strict";
import type { ReviewSnapshot, Section } from "../protocol.ts";
import { AppStore, type AppState } from "../store.ts";
import { FakeBackend, section } from "../test-support.ts";
import { buildCommands, filterCommands, fuzzyScore, type Command } from "./command-palette.ts";
import type { DiffSurface } from "./diff-surface.ts";

function chapter(title: string, sections: readonly Section[]): ReviewSnapshot["review"]["chapters"][number] {
  return { title, summary: null, sections };
}

function snapshot(chapters: ReviewSnapshot["review"]["chapters"]): ReviewSnapshot {
  const masterList = chapters.flatMap((c) => c.sections.flatMap((s) => s.atoms));
  return {
    context: "ctx" as ReviewSnapshot["context"],
    review: { chapters, masterList },
    marks: [],
    comments: [],
    progress: { total: masterList.length, addressed: 0, unaddressed: masterList.length },
    completed: false,
  };
}

const STORE = new AppStore(new FakeBackend());
const SURFACE: DiffSurface = { render() {}, toggleSideBySide() {} };

function stateWith(snap: ReviewSnapshot | null): AppState {
  return {
    connection: "open",
    snapshot: snap,
    error: null,
    activeSection: null,
    expandedChapters: new Set<number>(),
  };
}

const cmd = (id: string, title: string): Command => ({ id, title, run: () => {} });

test("fuzzyScore matches a subsequence and rejects a non-subsequence", () => {
  assert.ok(fuzzyScore("nxt", "Next section") !== null);
  assert.equal(fuzzyScore("zzz", "Next section"), null);
});

test("fuzzyScore: empty query matches everything neutrally", () => {
  assert.equal(fuzzyScore("", "anything"), 0);
  assert.equal(fuzzyScore("   ", "anything"), 0);
});

test("fuzzyScore rewards contiguity and a start hit", () => {
  const contiguous = fuzzyScore("next", "Next section");
  const scattered = fuzzyScore("nsc", "Next section");
  assert.ok(contiguous !== null && scattered !== null);
  assert.ok(contiguous > scattered);
});

test("filterCommands drops misses and ranks best match first", () => {
  const commands = [cmd("a", "Skip section"), cmd("b", "Next section"), cmd("c", "Mark done")];
  const result = filterCommands(commands, "next");
  assert.deepEqual(
    result.map((c) => c.id),
    ["b"],
  );
});

test("filterCommands with empty query keeps original order", () => {
  const commands = [cmd("a", "One"), cmd("b", "Two")];
  assert.deepEqual(
    filterCommands(commands, "").map((c) => c.id),
    ["a", "b"],
  );
});

test("buildCommands returns nothing without a review", () => {
  assert.deepEqual(buildCommands(stateWith(null), STORE, SURFACE), []);
});

test("buildCommands lists the static actions with their hints and one jump per Section", () => {
  const snap = snapshot([
    chapter("C0", [section("S0", ["a"]), section("S1", ["b"])]),
    chapter("C1", [section("S2", ["c"])]),
  ]);
  const commands = buildCommands(stateWith(snap), STORE, SURFACE);

  assert.deepEqual(
    commands.filter((c) => c.hint !== undefined).map((c) => [c.id, c.hint]),
    [
      ["next", "j"],
      ["prev", "k"],
      ["done", "d"],
      ["skip", "s"],
      ["sideBySide", "v"],
    ],
  );

  const jumps = commands.filter((c) => c.id.startsWith("jump:"));
  assert.deepEqual(
    jumps.map((c) => [c.id, c.title]),
    [
      ["jump:0:0", "Jump to C0 › S0"],
      ["jump:0:1", "Jump to C0 › S1"],
      ["jump:1:0", "Jump to C1 › S2"],
    ],
  );
});
