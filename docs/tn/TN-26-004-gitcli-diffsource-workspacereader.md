---
number: 26-004
title: GitCli adapters — DiffSource and WorkspaceReader
kind: plan
status: active
issue: "#6"
tags: [adapter, git, node, hexagonal]
---

# TN-26-004: GitCli DiffSource and WorkspaceReader

Wave 2 driven adapters in `packages/node`, implementing the `DiffSource` and `WorkspaceReader` ports from `packages/core` (ADR-0003). git owns mechanical truth (ADR-0002); these adapters run git and parse its output to the domain-neutral `RawHunk` contract. They parse only — the domain maps `RawHunk → Atom` and owns identity.

## Leakage discipline (ADR-0003, CLAUDE.md)

git specifics (SHAs, `@@` headers, `a/`/`b/` prefixes, `origin/main`, `/dev/null`) stay inside this adapter. Nothing git-shaped flows back into `packages/core`. The ports (`DiffSpec`, `FileSide`, `RawHunk`) are the only contract; they are already adapter-neutral.

## Module layout (`packages/node/src/git`)

```
run.ts               runGit(args, cwd): spawn git, return stdout; typed failure
parse-diff.ts        parseDiff(stdout): RawHunk[] — pure parser, no IO
diff-source.ts       GitDiffSource implements DiffSource
workspace-reader.ts  GitWorkspaceReader implements WorkspaceReader
refs.ts              DiffSpec -> { base, head } git refs (shared by both adapters)
```

Barrel `src/index.ts` re-exports the public adapter classes (additive only).

## DiffSource

`diff(spec)` derives git args from the shared `refs.ts` mapping, runs `git diff -U0 --histogram -M`, then `parseDiff`:

- `worktree` → `git diff -U0 --histogram -M origin/main` (live tree vs trunk).
- `range` → `git diff -U0 --histogram -M <base> <head>`.
- `pr` → throws `"PR diffs not yet supported"` (arrives with the GitHub adapter).

`-U0` means no context lines, so `RawHunk.lines` is added/removed only.

### Parsing

Split stdout on `diff --git ` file sections. Per section:

- **status**: `new file mode` → added; `deleted file mode` → deleted; `rename from`/`rename to` → renamed; else modified.
- **path / previousPath**: renames from the `rename from`/`rename to` lines; otherwise the non-`/dev/null` side of `--- a/…` / `+++ b/…`, stripping the `a/`/`b/` prefix. `previousPath` is null unless renamed.
- **hunks**: each `@@ -os[,ol] +ns[,nl] @@` header → one `RawHunk`; omitted counts default to 1. Body lines: `-` → removed, `+` → added, text is the line minus its single prefix. `\ No newline…` markers are skipped.

### Deliberate non-goals

- **Pure renames / mode-only / binary changes produce no `@@` hunk, hence no `RawHunk`.** atoms are git hunks (ADR-0002); a zero-content change has no hunk, so it is not an atom. Renames *with* content changes are covered (status `renamed`, each hunk carries `previousPath`). Synthesising an empty-payload atom would contaminate the model, so we do not.
- **Quoted paths** (paths with special chars that git C-quotes) are out of scope; fixtures use plain names. Revisit if a real diff needs it.
- **Untracked files in a `worktree` diff.** `git diff origin/main` reports tracked changes only, so a brand-new unstaged file produces no hunk (yet `WorkspaceReader` still reads it from disk on the head side). Surfacing untracked adds is a later refinement (e.g. `git add -N`) and belongs with the composition root, not this parser.

## WorkspaceReader

`readFile(path, side)` returns file content for the `base`/`head` side, or null when absent that side. Constructed with the refs resolved from the `DiffSpec`:

- a revision ref → `git show <rev>:<path>`; a missing path makes git exit non-zero → return null.
- the worktree (head of a `worktree` review) → read the file from disk; ENOENT → null.

`refs.ts` maps a `DiffSpec` to `{ base, head }` so DiffSource and WorkspaceReader agree on what each side means. The composition root (later issue) wires the two together.

## Tests

`node --test` (glob already covers `packages/*/src/**/*.test.ts`).

- **`parse-diff.test.ts`** — pure unit tests on canned git output: add, delete, multi-hunk modify, rename-with-changes, no-comma hunk headers, no-newline marker, empty diff.
- **`diff-source.test.ts` / `workspace-reader.test.ts`** — integration against a throwaway git repo built in a temp dir per test (deterministic author/committer env). `origin/main` is simulated with `git update-ref refs/remotes/origin/main <sha>` so the `worktree` spec is exercised without a network remote. Covers range + worktree, renames, adds, deletes, and `readFile` null-on-absent for both sides.

## Out of scope

PR diffs (GitHub adapter), the composition root wiring, HTTP/WS server.
