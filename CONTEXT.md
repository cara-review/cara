# cara

A local-first, diff-first conversational code reviewer. The agent reads a whole diff, reorganises it into a navigable structure, and surfaces the right part at the right time.

## Language

**Review**:
The whole tree for one diff. Root of Review → Chapters → Sections → atoms.

**Chapter**:
A major tranche of intent, ordered by importance.
_Avoid_: section (means something narrower), group.

**Section**:
A curated group of related change within a Chapter, ordered by relevance (theme, not git position).
_Avoid_: group, cluster.

**atom**:
One git hunk; the indivisible mechanical unit. Internal plumbing — never surfaced to users. Its user-facing rendering is a **change-block** (or just "block").
_Avoid_: hunk (in user-facing copy), chunk; atom (in user-facing copy).

**mark**:
A disposition on an atom — `done` or `skipped` — keyed by content hash of the atom's payload, carrying its author tier (`human` | `agent`). Agent marks never masquerade as human attestation; policy (e.g. a completeness gate) may require human-tier marks on specific atoms. Set per-block (tick one change-block) or per-Section (mark all its atoms at once); a Section completes when its last atom is marked.

**comment**:
A freeform, atom-anchored note written by the reviewer — never categorised by the author (no intent buttons; like a GitHub review comment). The acting agent infers what's needed from the text: edit code (detected mechanically by the atom's hash changing) and/or reply with an answer (attached back to the comment, rendered inline at the atom as untrusted overlay). A comment is `open` until its atom's payload changes or an answer attaches; the reviewer adjudicates on reopen. May optionally pin to one line within its atom by **content + side** (never a line number) — display-only: it refines where the comment shows, falls back to the end of the hunk when that line no longer matches, and never changes the atom-level mark.
_Avoid_: intent categories, chat (there is no chat surface; the comment is the only conversational interface).

**reshape**:
A review-level request from the human (browser) asking the agent for a different *view* of the diff — regroup ("split the tests out"), filter to a subset ("show only the public-interface changes"; the rest sweeps to "Other changes" via the bijection), or answer a question as a view. **Not** a comment: no atom anchor, no author tier beyond the human channel, never affects counts or the bijection. Routed to the agent via `dispatch`; the agent answers by **re-presenting**, which live-refreshes the open browser (marks intact). The comment stream stays code-only.
_Avoid_: treating it as a comment or a chat turn.

**AI summary**:
An agent-written markdown description of a Chapter or Section, rendered (sanitized subset) at the top of it as an untrusted orienting aid ("pinch of salt"). **Required on every Chapter and Section** — `present` rejects an agent grouping missing one and returns the missing list to complete (the engine-swept "Other changes" chapter and the git-order floor are exempt). Its content follows the layered instructions (system methodology + project `CARA.md` + personal `~/.cara/CARA.md`) — e.g. a pref like "list the test types in test sections". Never authoritative, never alters or substitutes for the diff. No per-block summaries — the change-block is its own evidence.
_Avoid_: framing it as a verdict or review conclusion; calling it optional.

**master list**:
The complete, canonical set of atoms for a Review, computed by the domain straight from the diff. Authoritative; the agent grouping can never add to, remove from, or hide it.

**grouping**:
The agent's arrangement of the master list into Chapters and Sections. A disposable overlay, regenerated when the atom set changes; never authoritative over what exists.

**review context**:
The specific diff under review (`feat-x..origin/main`, the uncommitted worktree, or `pr/63`). Reviews are isolated per context; marks never bleed between them.
_Avoid_: session.

### Form factor options (decision in #1)

**standalone desktop**:
A packaged native desktop app (e.g. Electron/Tauri). Full UI control; heaviest to build and ship.

**in-host MCP app**:
cara riding inside an existing host (Claude Code / Claude Desktop) as an MCP server rendering inline HTML. **Eliminated (#1):** inline HTML needs a graphical canvas; the dominant host (Claude Code) is a terminal with none, and the focused keyboard-driven split-pane experience can't live in a borrowed panel.

**local web app**:
The `cara` CLI boots a localhost server and opens an `--app`-mode browser window. Full web-UI control, reuses local git + creds, no native packaging. **Chosen for v1 (#1, ADR-0001).** A later Electron wrapper over the same UI is the deferred upgrade.

## Flagged ambiguities

- **"voice"** — the concept calls voice the *primary input*. Resolved: cara does **not** build voice capture. Speech→text is delegated to OS-level dictation (e.g. Super Whisper) typing into any focused text field. The distinct feature "agent drafts a comment from your spoken intent" is independent of input method and survives. Voice is therefore **not** a form-factor discriminator.

## Relationships

- A **Review** is scoped to exactly one **review context**
- A **Review** has one or more **Chapters**
- A **Chapter** has one or more **Sections**
- A **Section** groups one or more **atoms** (which may come from several files)
- A **mark** belongs to exactly one **atom**
- The **master list** is the canonical atom set of a **Review**; a **grouping** arranges it but cannot add, remove, or hide atoms
