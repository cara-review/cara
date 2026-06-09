import { test } from "bun:test";
import assert from "node:assert/strict";
import { CliError, parseCommand } from "./parse.ts";

test("bare invocation is the review porcelain over the worktree", () => {
  assert.deepEqual(parseCommand([]), {
    verb: "review",
    spec: { kind: "worktree" },
    headless: false,
    reviewers: [],
    fake: false,
  });
});

test("a leading range is the porcelain over that range", () => {
  assert.deepEqual(parseCommand(["main..feature"]), {
    verb: "review",
    spec: { kind: "range", base: "main", head: "feature" },
    headless: false,
    reviewers: [],
    fake: false,
  });
});

test("review collects repeated --reviewer lenses and the headless / fake flags", () => {
  assert.deepEqual(parseCommand(["--headless", "--reviewer", "security", "--reviewer", "architecture", "--fake"]), {
    verb: "review",
    spec: { kind: "worktree" },
    headless: true,
    reviewers: ["security", "architecture"],
    fake: true,
  });
});

test("review rejects an unknown option and a dangling --reviewer", () => {
  assert.throws(() => parseCommand(["--bogus"]), /Unknown option/);
  assert.throws(() => parseCommand(["--reviewer"]), /needs a value/);
});

test("review rejects a non-slug --reviewer (no path traversal into the lens directory)", () => {
  assert.throws(() => parseCommand(["--reviewer", "../../etc/passwd"]), /lowercase slug/);
  assert.throws(() => parseCommand(["--reviewer", "Security"]), /lowercase slug/);
});

test("a reviewer label is bounded — an over-long slug is rejected on both review and submit", () => {
  const long = "a".repeat(41);
  assert.throws(() => parseCommand(["--reviewer", long]), /at most 40 characters/);
  assert.throws(() => parseCommand(["submit", "{}", "--reviewer", long]), /at most 40 characters/);
});

test("submit's --reviewer is a bounded slug too (it renders into the tier badge)", () => {
  assert.throws(() => parseCommand(["submit", "{}", "--reviewer", "Security"]), /lowercase slug/);
  const ok = parseCommand(["submit", "{}", "--reviewer", "security"]);
  assert.equal(ok.verb === "submit" ? ok.reviewer : null, "security");
});

test("atoms defaults to the worktree and accepts a range positional", () => {
  assert.deepEqual(parseCommand(["atoms"]), { verb: "atoms", spec: { kind: "worktree" } });
  assert.deepEqual(parseCommand(["atoms", "a..b"]), { verb: "atoms", spec: { kind: "range", base: "a", head: "b" } });
});

test("present reads its grouping from an inline object, a file, or stdin", () => {
  assert.deepEqual(parseCommand(["present", '{"chapters":[]}']), {
    verb: "present",
    spec: { kind: "worktree" },
    grouping: { kind: "inline", json: '{"chapters":[]}' },
    open: true,
  });
  const file = parseCommand(["present", "grouping.json"]);
  assert.deepEqual(file.verb === "present" ? file.grouping : null, { kind: "file", path: "grouping.json" });
  const stdin = parseCommand(["present", "-"]);
  assert.deepEqual(stdin.verb === "present" ? stdin.grouping : null, { kind: "stdin" });
  const omitted = parseCommand(["present"]);
  assert.deepEqual(omitted.verb === "present" ? omitted.grouping : null, { kind: "stdin" });
});

test("--no-open flips present to headless", () => {
  const cmd = parseCommand(["present", "-", "--no-open"]);
  assert.equal(cmd.verb === "present" && cmd.open, false);
});

test("--range threads a range through present/dispatch/submit", () => {
  const present = parseCommand(["present", "-", "--range", "a..b"]);
  assert.deepEqual(present.verb === "present" && present.spec, { kind: "range", base: "a", head: "b" });
  const dispatch = parseCommand(["dispatch", "--range", "a..b"]);
  assert.deepEqual(dispatch.verb === "dispatch" && dispatch.spec, { kind: "range", base: "a", head: "b" });
});

test("a range side starting with '-' is rejected (git arg injection, CWE-88)", () => {
  // Without the guard, `--output=…` would reach `git diff` as a real flag and write a file.
  assert.throws(() => parseCommand(["atoms", "--range", "--output=/tmp/pwn..HEAD"]), /cannot start with "-"/);
  assert.throws(() => parseCommand(["dispatch", "--range", "HEAD..-O/tmp/pwn"]), /cannot start with "-"/);
  // A legitimate range is unaffected.
  assert.deepEqual(parseCommand(["atoms", "main..feature"]), {
    verb: "atoms",
    spec: { kind: "range", base: "main", head: "feature" },
  });
});

test("dispatch flags: --wait plus second-granularity thresholds", () => {
  assert.deepEqual(parseCommand(["dispatch"]), {
    verb: "dispatch",
    spec: { kind: "worktree" },
    wait: false,
    timeoutS: null,
    idleThresholdS: null,
  });
  assert.deepEqual(parseCommand(["dispatch", "--wait", "--timeout", "120", "--idle-threshold", "60"]), {
    verb: "dispatch",
    spec: { kind: "worktree" },
    wait: true,
    timeoutS: 120,
    idleThresholdS: 60,
  });
});

test("submit carries the batch positional and an optional reviewer label", () => {
  assert.deepEqual(parseCommand(["submit", '{"marks":[]}', "--reviewer", "security"]), {
    verb: "submit",
    spec: { kind: "worktree" },
    batch: { kind: "inline", json: '{"marks":[]}' },
    reviewer: "security",
  });
});

test("instructions takes no arguments", () => {
  assert.deepEqual(parseCommand(["instructions"]), { verb: "instructions" });
  assert.throws(() => parseCommand(["instructions", "x"]), CliError);
});

test("--pr is rejected wherever a spec is parsed", () => {
  assert.throws(() => parseCommand(["atoms", "--pr"]), CliError);
});

test("malformed ranges are rejected, not silently mangled", () => {
  for (const bad of ["main..", "main...feature", "a..b..c"]) {
    assert.throws(() => parseCommand(["atoms", bad]), CliError);
  }
});

test("a value flag missing its value, and an unknown flag, both error", () => {
  assert.throws(() => parseCommand(["dispatch", "--timeout"]), CliError);
  assert.throws(() => parseCommand(["dispatch", "--bogus"]), CliError);
  assert.throws(() => parseCommand(["dispatch", "--timeout", "-5"]), CliError);
});
