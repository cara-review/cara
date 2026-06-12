---
number: 26-037
title: "clear-diff → cara: consolidation, two ledger fixes, rename sweep, global install + publish-prep"
kind: plan
status: active
issue: "#47"
tags: [cara, rename, ledger, consolidation, release, publish, plan]
---

# TN-26-037: clear-diff → cara — consolidation + rename + publish-prep

The product is now **cara** (CARA: Content-Addressed Review Attestation, TN-26-031/032). This plan
lands the `feat/cara-ledger` work on `main`, folds the two Worthy-bundle-proven fixes into source
*with tests*, renames the whole project clear-diff → cara, makes `cara` a global command on this
machine (browser UI included), and preps the npm package — **without publishing** (name disputed).

Four implementer tasks: **#29 consolidate+fixes → #30 rename sweep → #31 global+publish-prep →
#32 verify+ship.** Strictly sequential (each pushes `main`; the next pulls).

## Key facts (owner, in-session)
- npm package **name = `cara-temp`** (bare `cara` is squatted by a dead 2018 pkg; owner pursuing
  the dispute). The installed **command stays `cara`**. So `package.json name="cara-temp"`,
  `bin.cara`. Fallback if dispute stalls: `@<scope>/cara`.
- **Do NOT `npm publish`** — owner runs it once the name is secured. This plan stops at `npm pack`.
- Both fixes were proven live in Worthy bundles; they MUST land in source with regression tests.

---

## #29 — Consolidate `feat/cara-ledger` + land the two fixes

### 29.1 Consolidate onto main
`origin/feat/cara-ledger` is 12 commits ahead of `main`, base = current `main` (0 main-only) → a
clean fast-forward **as of this plan's authoring**. This plan TN is itself a docs commit on `main`,
so by the time #29 runs `main` will have diverged by exactly this TN (disjoint files).

- `git fetch origin`.
- If `git merge-base --is-ancestor origin/main origin/feat/cara-ledger` still true → `git merge
  --ff-only origin/feat/cara-ledger` on `main`.
- Else (the expected case — this TN landed) → rebase the 12 commits onto `main` (conflict-free: they
  touch none of this TN's files), then ff `main` to the rebased tip:
  ```
  git worktree add ../clear-diff-tmp/cara-rebase -b cara-rebase origin/feat/cara-ledger
  cd ../clear-diff-tmp/cara-rebase && git rebase origin/main   # rebased tip = HEAD
  cd <main worktree> && git merge --ff-only cara-rebase
  ```
  Verify with `git diff` that the only main-side delta vs the branch is this TN + its README row.
- This lands: GitLedgerStore (`refs/cara/ledger`), ADR-0005 rewrite, ADR-0013/0014/0015,
  `cara gate` (role coverage + scrutiny predicate), repo-wide coverage, removal of
  `JsonlReviewStore`/`review-store.ts`. **Do the fixes below in the SAME push** so `main` never
  carries the known-buggy ledger.

### 29.2 Fix A — per-append nonce in GitLedgerStore
**Bug:** `append` path is `<contextHash>/<factId>.json`, `factId = sha256(canonicalFact)`. Two
genuinely-distinct appends with identical canonical bytes (same atom, same disposition, same `ts`
under a fixed clock — exactly the test path, and any rapid identical re-mark) collide to one path →
the second append is silently a no-op "dedupe", **losing a fact**. Content-addressing conflates
"identical bytes" with "same event".

**Fix** (`packages/node/src/git/ledger-store.ts`):
- Path becomes `<contextHash>/<factId>.<nonce>.json`. `nonce` = a per-append random token
  (`crypto.randomUUID()` or `randomBytes(8).hex`) — distinct per `append` call, so distinct events
  never collide regardless of byte-equality.
- **Blob stays pure canonical** (the nonce lives only in the filename, never in the stored bytes) →
  `factId` integrity is unchanged in spirit.
- Integrity check in `#readFact`: a single compound predicate —
  `basename.startsWith(factId(canonicalFact(parsed)) + ".") && basename.endsWith(".json")` —
  replaces `basename === factId + ".json"`. The nonce (any non-empty string between the two dots)
  is **unconstrained and safe**: a swapped blob changes the canonical bytes → factId prefix fails;
  a relabelled filename fails the prefix; keeping the prefix correct while changing the blob is a
  SHA-256 preimage. Tamper-rejection is preserved.
- `#addedPaths` / per-commit order recovery is unaffected (still one added blob per commit).
- **Consequence to document inline:** genuine dedupe of an identical re-append is gone — an
  idempotent re-append now writes a second commit/blob. That is correct: the order-from-topology
  fold already needs one-commit-per-append, and a true duplicate fact is now preserved as a
  distinct event rather than dropped. The clean tree-union concurrent-merge story still holds
  (disjoint nonces ⇒ disjoint paths; no two writers ever touch the same path).
- **Tests** (`ledger-store.test.ts`): (1) two appends of a byte-identical fact under a fixed clock
  both survive `load` in order (this is the regression that fails today); (2) integrity check still
  rejects a blob whose canonical bytes don't match its filename's leading segment.

### 29.3 Fix B — existence-based multi-role coverage (one shared counter)
**Bug:** `reviewProgress(masterList, marks, comments)` folds via the last-write-wins `marks` Map, so
`byReviewer` and per-tier `scrutiny` are **last-writer attribution**: an atom dispositioned by two
reviewer labels (or both tiers) credits only the later writer. `repoProgress` already does the right
thing (existence sets over events) but duplicates the whole counter. Multi-role coverage on a single
context under-counts.

**Fix** (`packages/core/src/marks.ts`): collapse both into one existence-based counter.
- New `coverageProgress(masterList, events, applyUnmark)` → `ReviewProgress`. Folds the raw event
  log (not the `marks` Map) into **per-(atom,tier)** and **per-(atom,label)** *existence sets* for
  dispositions and a **per-(atom,tier)** set for comments, then counts those sets over the master
  list (`addressed` = atoms with ≥1 disposition from any role; `byReviewer[label]` = atoms a label
  dispositioned; `scrutiny[tier]` = per-tier accounted/commented; `accounted` = disposition OR
  comment). Output shape identical to today, so the gate evaluator and snapshot consumers are
  untouched.
- `applyUnmark`:
  - `true` (single context, order matters): process events in order; `unmarked` removes
    `(hash, event.author.tier)` from the disposition tier-set, and `(hash, event.author.reviewer)`
    from the label-set **only when `reviewer !== null`** (`MarkAuthor.reviewer` is `string | null`;
    a null-label unmark touches no label-set). Each role's own retraction nets only its own attention.
  - `false` (repo-wide, ADR-0014 §3): ignore `unmarked` entirely — a `marked` fact is evidence the
    role attended that content; there is no cross-context "later" to net against.
- `reviewProgress(masterList, events)` = `coverageProgress(masterList, events, true)`.
- `repoProgress(masterList, events)` = `coverageProgress(masterList, events, false)`.
  Delete the now-duplicated body of both; they become thin wrappers.
- **Signature change:** `reviewProgress` drops `(marks, comments)`, takes `(masterList, events)`.
  `isAccounted` / `isSectionComplete` / `buildGapReport` keep using the folded `marks` Map (gap +
  completeness are correctly last-write-wins) — untouched.

**Callers** (`packages/core/src/review-service.ts`, exactly 3 sites): `buildSnapshot`, `submit`,
`dispatch` each call `reviewProgress(masterList, state.marks, state.comments)`. Each already loads
the log inline (`project(await deps.store.load(context))`) — capture the events there:
`const events = await deps.store.load(context); const state = project(events);` then
`reviewProgress(masterList, events)`. `buildSnapshot` still uses `state.marks` for the snapshot's
`marks` array; only the progress call changes.

**Tests:** update `marks.test.ts` (the existing reviewProgress cases switch to the events
signature) + `review-service.test.ts`. Add the regressions Fix B is for:
- single context, one atom dispositioned by **two reviewer labels** → `byReviewer` credits **both**
  (today: only the last); marked-then-unmarked by the same role nets to absent under `applyUnmark`.
- single context, same atom dispositioned by agent **and** human → `scrutiny` shows **both** tiers.

### 29.4 Resolve the two ADR-0014 `Owner-ratify` markers (owner-delegated, AS-SHIPPED)
Owner delegated ratification in-session. Edit `docs/adr/0014-repo-wide-coverage.md`:
- §7 "empty net range is `indeterminate`, never a vacuous pass" — strike the `*(Owner-ratify…)*`
  note; ratified as shipped (the deliberate divergence from ADR-0013 §4 stands).
- Alternatives, "`--by-file` map on `gate` vs its own verb" — strike the `*(Owner-ratify…)*` note;
  ratified as shipped (kept on `gate` for v1; a future split is non-breaking).
Leave the design text otherwise intact.

### 29.5 Fix TN-26-034 stale scope
`docs/tn/TN-26-034-*.md` says "**no new port**", "No rename — stays clear-diff", and "All work
lands on `feat/cara-ledger` … never main". All three are now stale:
- ADR-0014 **did** add a port method (`ReviewStore.loadAll()`) — correct the "no new port" claim to
  note the read-only `loadAll` follow-on.
- Add a superseding note: the no-rename / never-main delivery constraints are lifted by **this TN**
  (consolidation onto `main` + the cara rename). Point to TN-26-037.

### 29.6 Also fix on the way (cheap, in-scope)
- `docs/tn/README.md` on the branch indexes 034/035 but **not 036**. After the rebase, check whether
  the rebased README already carries the 036 row (it may arrive via main); add it only if missing.

Push `main`. Pre-push hook green (lint + `bun run test` + `bun run test:e2e`). **Never `--no-verify`.**

---

## #30 — Rename sweep: clear-diff → cara

One pass. ~367 textual `clear-diff` hits + 72 `@clear-diff/` import sites. Build + `bun install`
regenerate `bun.lock`/`apps/web/dist` mechanically — don't hand-edit generated artefacts.

### What renames
**Packages & imports** (72 sites): `@clear-diff/core|node|web` → `@cara/core|node|web` in every
`package.json name`/`dependencies` and every import specifier. `bun install` after to regen lock.

**Root `package.json`:** `name` `clear-diff` → **`cara-temp`** (publish name); `bin` `{ "clear-diff":
"./dist/index.js" }` → `{ "cara": "./dist/index.js" }`; `description` reword to cara; `repository` /
`homepage` / `bugs` URLs — see *Does NOT rename* (leave pointing at the live remote until the owner
renames the GitHub repo). `keywords` fine as-is.

**The command / bin:** `clear-diff` → `cara` everywhere it names the executable (README, concept,
ADRs, CLI help/usage, `instructions` self-narration text, e2e harness that spawns the bin).

**Config dir:** `~/.clear-diff` → `~/.cara`. `instructions.ts` `PERSONAL_FILE`
`".clear-diff/CLEAR_DIFF.md"` → `".cara/CARA.md"`; config path `~/.clear-diff/config.toml` →
`~/.cara/config.toml` (README, concept.md, ADR-0003, ADR-0011 prose).

**Instruction file:** `CLEAR_DIFF.md` → `CARA.md` — the `instructions.ts` `PROJECT_FILE`, the repo's
own root file (`git mv CLEAR_DIFF.md CARA.md`), and the personal `~/.cara/CARA.md` references.

**Env var:** `CLEAR_DIFF_EDITOR` → `CARA_EDITOR` (`config.ts` + `config.test.ts`); the test sentinel
`CLEAR_DIFF_DEFINITELY_UNSET_KEY` → `CARA_…` for consistency.

**InstructionsSource / `ports.ts`** doc comment naming the files.

**User-facing output strings:** sweep `clear-diff` in `packages/node/src` — `output.ts`, `discovery`,
`NEXT.*` next-step hints, `gate.ts`, the `instructions` verb body, any CLI error/help text.

**HTML title:** `apps/web/index.html` `<title>clear-diff</title>` → `cara` (dist regenerates on build).

**Ledger commit identity:** `ledger-store.ts` `LEDGER_IDENTITY` `GIT_AUTHOR_NAME`/`EMAIL`
`"clear-diff"`/`"ledger@clear-diff"` → `"cara"`/`"ledger@cara"`. (commit `-m "cara"` and the
`cara-ledger-` tmpdir prefix are already cara.) **Prefer doing this in #29** (with the ledger
landing fresh) so every committed fact carries the `cara` identity from the first commit; listed
here only for rename-map completeness.

**Tests/fixtures:** any `clear-diff` literal in test tmpdir names, fixtures, e2e expectations.

**Docs:** README, `docs/concept.md` (front-matter `title` + body), `CLAUDE.md`, `CONTEXT.md`, and
every ADR/TN prose mention of `clear-diff` → `cara`. Sweep prose; **do not** rename TN/ADR
*filenames* or numbers (immutable IDs), and do not rewrite a historical quote where the old name is
the literal subject (rare — most mentions are live product references and should change).

### Does NOT rename (flag in the issue)
- **The GitHub remote / repo slug `clear-diff/clear-diff`** — a **manual owner step**: rename the
  repo on GitHub, then update the `origin` URL and `package.json` `repository`/`homepage`/`bugs`.
  Until then those URLs stay as-is (renaming them pre-emptively breaks the links). Call this out
  explicitly as the one owner action.
- **`refs/cara/ledger`** and the `refs/cara/*` refspec — already cara.
- **TN/ADR filenames and numbers** — immutable identifiers.
- **`.agent-state/`** runtime dir (gitignored discovery/grouping scratch; unbranded) — leave.
- **The npm publish name is `cara-temp`, NOT `cara`** — only the *bin/command* is `cara`. This
  asymmetry is intentional; don't "fix" the package name to `cara`.

`bun install` → `bun run build:dist` → lint + `bun run test` + `bun run test:e2e` green. Push `main`.

---

## #31 — Global install (`cara`, UI included) + publish-prep

### Global install on THIS machine
- **Bundle:** `package.json` `files: ["dist", "README.md"]` already ships `dist`. Confirm
  `bun run build:dist` writes the **web UI into `dist/web`** (the `present` browser path serves the
  built app from the bundle) — if `pack-dist.ts` doesn't already copy `apps/web/dist` → `dist/web`,
  that's a blocker; verify the packed tree carries the UI before relying on the global bin's browser.
- **Override the existing Worthy shim:** `/opt/homebrew/bin/cara` currently symlinks the Worthy
  tool and sits ahead on `PATH`. Remove it (`rm /opt/homebrew/bin/cara`), and remove the stale
  `clear-diff` global (`/opt/homebrew/bin/clear-diff`) since the bin renamed.
- **Install:** from the repo root, `npm i -g .` (or `npm link`) installs bin `cara`. Confirm
  `which cara` now resolves to the new global, not the Worthy path.
- **Verify the UI works from the global install:** `cara present <grouping> --range …` opens the
  browser and serves the bundled web app (not a dev server); also smoke `cara instructions` and
  `cara --help`.

### Publish-prep (DO NOT publish)
- `name` `cara-temp`; `bin.cara`; `files` includes `dist` (with `dist/web`).
- Bump to **`0.6.0`** (rename + committed-ledger epoch), from whatever `main` carries when #31 runs.
- `prepublishOnly` = `build:dist` (already present) — keep.
- `npm pack --dry-run` and inspect the tarball: assert `dist/index.js` + `dist/web/**` present,
  README included, **no `src`/test leakage**.
- **Stop here.** No `npm publish` — owner publishes once `cara` is secured; `cara-temp` interim,
  `@<scope>/cara` fallback.

---

## #32 — Verify + review fleet + ship
- Full `bun run test` + `bun run test:e2e`; lint clean.
- Review fleet scaled to risk: **architect** (boundary/port discipline — the `loadAll` port, the
  marks counter refactor, no adapter leakage) + **security** (the nonce/integrity change, ledger
  trust caveats) + docs tier for the rename/ADR/TN edits. Apply findings before push.
- `cara` global smoke end-to-end: `present` (browser UI from the bundle), `gate`/`gate --repo`,
  `instructions`. Confirm a browser human-mark lands as a fact under `refs/cara/ledger` and reloads
  across a fresh process.
- Update issue #47 (delivered summary + review note), set status Done.

## Sequencing & risk
- Strictly sequential — each task pushes `main`, the next pulls. No worktree parallelism (the rename
  touches nearly every file; concurrent edits would collide).
- The fixes (#29) ship **with** the ledger so `main` never carries the buggy version.
- The single human/owner action is the **GitHub repo rename** (#30 flags it); everything else is
  autonomous trunk delivery. No new ADR is required (ADR-0014's two markers are owner-delegated
  ratifications, not deviations).
