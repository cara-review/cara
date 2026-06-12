import { test } from "bun:test";
import assert from "node:assert/strict";
import { CliError, parseCommand } from "./parse.ts";

test("bare invocation is the help banner (the cold-agent entry door)", () => {
  assert.deepEqual(parseCommand([]), { verb: "help", topic: null });
});

test("help / --help / -h all route to the root banner", () => {
  for (const argv of [["help"], ["--help"], ["-h"]]) {
    assert.deepEqual(parseCommand(argv), { verb: "help", topic: null });
  }
});

test("help narrows to a verb topic, both as `help <verb>` and `<verb> --help`", () => {
  assert.deepEqual(parseCommand(["help", "present"]), { verb: "help", topic: "present" });
  assert.deepEqual(parseCommand(["present", "--help"]), { verb: "help", topic: "present" });
  assert.deepEqual(parseCommand(["gate", "-h"]), { verb: "help", topic: "gate" });
});

test("a leading --help/-h is always the root banner — only `help <verb>` narrows", () => {
  assert.deepEqual(parseCommand(["--help", "atoms"]), { verb: "help", topic: null });
  assert.deepEqual(parseCommand(["-h", "gate"]), { verb: "help", topic: null });
});

test("an unknown help topic falls back to the root banner", () => {
  assert.deepEqual(parseCommand(["help", "bogus"]), { verb: "help", topic: null });
  assert.deepEqual(parseCommand(["help", "serve"]), { verb: "help", topic: null });
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

test("gate parses comma-separated --require predicates (both = and >= mean 'at least')", () => {
  const cmd = parseCommand(["gate", "--require", "security=100%,human>=50%,addressed=80", "--range", "a..b"]);
  assert.deepEqual(cmd, {
    verb: "gate",
    spec: { kind: "range", base: "a", head: "b" },
    requirements: [
      { role: "security", threshold: 100 },
      { role: "human", threshold: 50 },
      { role: "addressed", threshold: 80 },
    ],
    repo: false,
    byFile: false,
  });
});

test("gate without --require is a coverage readout (no requirements)", () => {
  assert.deepEqual(parseCommand(["gate"]), {
    verb: "gate",
    spec: { kind: "worktree" },
    requirements: [],
    repo: false,
    byFile: false,
  });
});

test("gate --repo enables the cross-context fold; --by-file implies --repo", () => {
  const repo = parseCommand(["gate", "--repo", "--require", "security=100%"]);
  assert.equal(repo.verb === "gate" ? repo.repo : null, true);
  assert.equal(repo.verb === "gate" ? repo.byFile : null, false);
  const byFile = parseCommand(["gate", "--by-file"]);
  assert.deepEqual(byFile, { verb: "gate", spec: { kind: "worktree" }, requirements: [], repo: true, byFile: true });
});

test("gate rejects malformed predicates, an over-100 percent, a non-slug role, and positionals", () => {
  assert.throws(() => parseCommand(["gate", "--require", "security"]), /Invalid --require/);
  assert.throws(() => parseCommand(["gate", "--require", "security=150%"]), /cannot exceed 100/);
  assert.throws(() => parseCommand(["gate", "--require", "Security=100%"]), /Invalid --require/);
  assert.throws(() => parseCommand(["gate", "extra"]), /no positional/);
});

test("gate accepts a <tier>:commented scrutiny role and rejects :commented on a non-tier role", () => {
  assert.deepEqual(parseCommand(["gate", "--require", "agent:commented>=30%"]), {
    verb: "gate",
    spec: { kind: "worktree" },
    requirements: [{ role: "agent:commented", threshold: 30 }],
    repo: false,
    byFile: false,
  });
  assert.throws(() => parseCommand(["gate", "--require", "security:commented=100%"]), /applies only to human or agent/);
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
