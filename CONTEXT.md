# clear-diff

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
One git hunk; the indivisible mechanical unit. Internal plumbing — never surfaced to users.
_Avoid_: hunk (in user-facing copy), chunk.

**mark**:
A user's disposition on an atom — `done` or `skipped` — keyed by content hash of the atom's payload.

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
clear-diff riding inside an existing host (Claude Code / Claude Desktop) as an MCP server rendering inline HTML. **Eliminated (#1):** inline HTML needs a graphical canvas; the dominant host (Claude Code) is a terminal with none, and the focused keyboard-driven split-pane experience can't live in a borrowed panel.

**local web app**:
The `clear-diff` CLI boots a localhost server and opens an `--app`-mode browser window. Full web-UI control, reuses local git + creds, no native packaging. **Chosen for v1 (#1, ADR-0001).** A later Electron wrapper over the same UI is the deferred upgrade.

## Flagged ambiguities

- **"voice"** — the concept calls voice the *primary input*. Resolved: clear-diff does **not** build voice capture. Speech→text is delegated to OS-level dictation (e.g. Super Whisper) typing into any focused text field. The distinct feature "agent drafts a comment from your spoken intent" is independent of input method and survives. Voice is therefore **not** a form-factor discriminator.

## Relationships

- A **Review** is scoped to exactly one **review context**
- A **Review** has one or more **Chapters**
- A **Chapter** has one or more **Sections**
- A **Section** groups one or more **atoms** (which may come from several files)
- A **mark** belongs to exactly one **atom**
- The **master list** is the canonical atom set of a **Review**; a **grouping** arranges it but cannot add, remove, or hide atoms
