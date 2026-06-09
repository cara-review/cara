---
title: "clear-diff — Design Brief"
category: personal
tags: [design, brief, ui, ux, clear-diff, desktop, keyboard-native]
status: active
date_created: 2026-06-05
last_updated: 2026-06-10
---

# clear-diff — Design Brief

A brief for a product/UI designer. It fixes layout, states, interactions, the keyboard model, and which tokens to define, and leaves exact colour, type, and spacing values for you to propose. Read [`concept.md`](concept.md) for the full product model; this doc is the visual and interaction surface over it.

**What you are designing:** a desktop app for reviewing a code diff that has been *restructured* into a navigable tree, not dumped as a wall of lines. Crisp, fast, keyboard-native. The feel of Linear / Raycast / Zed: a serious pro tool that's a pleasure to fly through.

Initial dark + light prototypes already exist, with proposed token values, layout dimensions, and a component inventory — see [`design/initial-prototypes.md`](design/initial-prototypes.md). Treat them as a starting point, not a constraint.

---

## Platform & constraints

- **Desktop only.** macOS-first. **No mobile, no tablet, no responsive-down.** Design for a real Mac window. Assume a minimum window of ~1100×700 and design up from there; the layout may go full-screen on a large display.
- **Light and dark mode, both first-class.** Follow the macOS system appearance and switch with it. Neither is an afterthought; design both in parallel.
- **It's a local web app in an `--app`-mode browser window** (no browser tab chrome, no address bar) — so it reads as a native window, but it is web tech. A later Electron wrapper is the same UI in a native frame; don't depend on browser-tab affordances.
- **Keyboard-native is a hard requirement, not a polish item.** Every action reachable by key and by command palette; the mouse is always optional. Traversal speed *is* the product.

---

## Design principles

1. **Structure first, diff second.** The diff is evidence surfaced on demand, never the front door. The interface is the *structure* over the change.
2. **Selective disclosure.** Show the important thing at the top; let detail unfold beneath. Calm by default, dense when asked.
3. **Keyboard-first, mouse-optional.** Every interaction has a key. A power user should never need the trackpad; a new user should still be able to click everything.
4. **Completion over coverage.** Success is *accounting for* every Section (done or skipped), not reading every line. The UI should make "what's left" obvious and satisfying to drive to zero.
5. **Low chrome, high signal.** Hairline borders, restrained colour, one accent. Let the code and the structure carry the screen.
6. **Quiet until it matters.** Status, counts, and motion stay subtle; they assert themselves only on change.

---

## Aesthetic direction

Anchor to **Linear / Raycast precision**:

- Tight, deliberate type scale. Small but highly legible UI text; a separate monospace family for code.
- A 4px spacing grid; dense but never cramped — every gap intentional.
- **One** accent colour (think indigo/violet family — your call), used sparingly for focus, selection, and primary action. Semantic colours (add/remove/warn) are their own restrained set.
- Hairline borders and subtle elevation over heavy shadows and boxes. Surfaces separated by tone, not chrome.
- The command palette is the spine of the app, not a hidden extra.
- Motion is fast and functional: 120–200ms, ease-out, communicates state change — never decorative.

Avoid: skeuomorphism, gradients-as-decoration, heavy drop shadows, rounded-everything, marketing-site flourish, more than one accent hue.

---

## Vocabulary you must respect

The product has an exact vocabulary. Use it in all labels and copy:

- **Review** — the whole thing, one diff.
- **Chapter** — a major tranche of intent. Ordered by importance. *("Event-bus migration", "New API surface", "Tests & fixtures".)*
- **Section** — a curated group of related change inside a Chapter. Ordered by theme, not file position.
- A trailing **"Other changes"** Section may exist (everything not deliberately grouped). Design it as a real, slightly de-emphasised Section.

**Never surface the word "atom" or "hunk."** Internally the diff is built from atoms (individual git hunks), but the user only ever sees Chapters and Sections. You will need to render the *consequences* of atoms (see Diff surface) without ever naming them.

---

## Window anatomy — 2-pane persistent

```
┌──────────────────────────────────────────────────────────────────────┐
│  Header: review context · progress · global actions          ⌘K       │
├────────────────┬───────────────────────────────────────────────────────┤
│  NAV           │  DIFF SURFACE                                          │
│  (Chapters &   │  (the evidence — atom/gap/atom)                        │
│   Sections)    │                                                        │
│                │  ▸ Section heading                                     │
│  ▾ Chapter     │    file.ts                                             │
│    • Section   │    ─ removed line                                      │
│    • Section   │    + added line          💬 comment / inline answer    │
│  ▸ Chapter     │    … gap …                                             │
│    • Section   │    + added line                                        │
│                │                                                        │
├────────────────┴───────────────────────────────────────────────────────┤
│  Footer / status bar: counts · current focus · key hints (optional)    │
└──────────────────────────────────────────────────────────────────────┘
```

**The comment is the only interface — there is no chat pane.** Questions and remarks are both comments on a line; an answer renders **inline at that line**, in the diff (see Commenting). Two persistent panes:
- **Resize** — drag the divider between the panes to rebalance widths; also adjustable by keyboard. Design sensible min/max widths and a clear divider/drag-handle affordance (hover + focus states).
- **Collapse** — nav collapses fully (by key and by handle), giving the diff the full width. A collapsed pane leaves a clear way to summon it back.
- The center diff is the hero and always present.
- Pane sizes and collapsed/expanded state **persist** across launches.

### Header
- **Review context** — what's under review, stated plainly: a worktree vs `origin/main`, two refs, or a PR. (e.g. `feature/x → origin/main`, or `PR #63`.)
- **Progress** — the headline completion signal, derived from the canonical change set (e.g. "38 of 412 changes left", or a thin progress meter). This number is authoritative and must never look smaller than the real change; design it to feel trustworthy.
- **Global actions** — the **mark-complete / "done"** action (signals the human is finished, so the agent picks the review up) lives here, plus the command-palette affordance (`⌘K`). There is no "send comments" button: dispatch is the agent's egress, not a human action — comments are already the agent's to collect.

### Nav pane (left) — the structure
- A two-level tree: **Chapters** (expandable) containing **Sections**.
- Each row shows: title, a count of changes, and a **mark state** glyph (unreviewed / done / skipped). Design these three states as instantly distinguishable at a glance — this is the most-scanned surface in the app.
- **Author tier on marks.** A mark is made by a `human` or an `agent` (e.g. a headless pre-review). Design a quiet **tier badge** so an agent-marked Section reads differently from a human-marked one — the human adjudicates the agent's residue. Agent marks may carry a **reviewer label** (`security`, `architecture`); surface it subtly where several lenses pre-reviewed.
- Chapters ordered by importance; Sections by relevance. A Section's count and state roll up from its changes.
- The currently-focused Section is clearly indicated and kept in sync with the diff pane.
- Needs a satisfying "this whole Chapter is done" state — driving a Chapter to zero should feel rewarding.

### Diff surface (center) — the evidence
This is **not** a normal file diff. Key rules:

- It renders the changes of the **focused Section** — which may pull lines from **several files**, and from **non-contiguous places within a single file**.
- Render as **change-block, gap, change-block**: a small run of changed lines, then a visible "… skipped N lines …" gap affordance, then the next run. **Never assume one continuous file.** A file can also appear again later in a different Section — that revisiting is intentional, not a bug.
- Each change-block is labelled with its file (and is clickable/keyable to **open the real file at that line** in the user's editor).
- Each change-block also carries its own **review tick** — a single click/key marks just that block reviewed (it dims back), and the Section auto-completes once every block is ticked. This is the "zap-zap-zap" path: power users tick block-by-block; others mark the whole Section in one key (see Flow 1). Both feed the same underlying state. Label it **"Reviewed" / "Mark reviewed"**, **never "atom"** or "hunk".
- Standard add/remove styling, syntax-aware. The diff is syntax-highlighted; added/removed use semantic colour *plus* a non-colour cue (so it survives colour-blindness and grayscale). The `+`/`-` sign is that cue — **don't strike through removed lines** (it hurts code legibility).
- A line is the unit you **comment** on: hovering/focusing a line exposes a comment affordance.
- Design **split (side-by-side)** and **unified (inline)** diff modes; unified is the default, both keyboard-toggleable.

**AI summary.** A Section **and** a Chapter may each be headed by a short, agent-written summary that orients the reviewer before they read the evidence. Design it as a distinct, clearly-labelled **"AI summary"** band — visually secondary to the diff, never styled as authoritative. It's a take-with-a-pinch-of-salt aid, not a verdict; the diff below is the source of truth. It must never look like it *replaces* reading the change. (Architecturally the agent can describe but never alter the diff — see [ADR-0004](adr/0004-agent-untrusted-master-list.md).)

### Inline answers — questions are comments
There is **no chat pane**. A question is just a comment phrased as one (*"is this backwards compatible?"*): the agent answers and the answer renders **inline at that line**, beneath the comment.

- Design the answer as a distinct, clearly-secondary block under the comment — **sanitized markdown** (headings, emphasis, code, lists, scheme-restricted links), never authoritative, same "pinch of salt" posture as the AI summary.
- An answered comment reads as **addressed**; the reviewer can re-raise by commenting again. Make the open → answered → re-raised lifecycle legible at the line.
- The agent infers from the comment text whether to edit code, answer, or both — there are no intent buttons or categories.

---

## Core flows to design

Design the full state of each, in light and dark.

### 1. Marking a Section
The primary loop. From a focused Section the user can **mark done** (`D`) or **skip** (`S`) with a single key. Design:
- **Two visible controls back the key:** a **Done** toggle in the section-header action row (beside Skip and the `J`/`K` nav hints), and a prominent **Done & Next** button below the diff as the end-of-section CTA. Both carry the **tick (✓) glyph, never an arrow** — the mark action reads identically wherever it appears. `D` drives both: mark done and advance.
- The transition (row + diff updating to the new state).
- Auto-advance: after marking, focus moves to the next unreviewed Section. Make that movement legible.
- Skipped Sections are de-emphasised but **never hidden or deleted** — always re-revealable. (Skip ≠ delete.)
- **Block-by-block path:** the user can instead tick individual change-blocks (see Diff surface); the Section flips to done automatically when the last block is ticked. Design how a partly-ticked Section reads — the nav row and Section header should show progress, not just binary done/undone — and keep whole-Section mark and block-ticking visibly consistent (ticking all blocks = marking the Section done).

### 2. Commenting on a line
- User focuses a line and starts a comment. Primary input is **voice via OS-level dictation** (the app does *not* build voice capture — the user dictates into a normal focused text field). So: design a clean, focusable comment composer that's pleasant to dictate into and to edit by keyboard.
- The agent **drafts the comment in the user's voice** from their spoken intent; the user reviews/edits before it's committed. Design the draft → review → accept micro-flow.
- Show where comments exist: a line with a comment needs a persistent, quiet marker, and a way to expand/collapse the comment thread inline.
- A comment may be a **question** — the agent's answer renders inline beneath it (see Inline answers). Design the comment → answer → re-raise lifecycle at the line; there is no separate Q&A surface.

### 3. Navigating the structure
- Move between Chapters, Sections, change-blocks, and lines entirely by keyboard, with a **single, always-visible focus indicator** that's unambiguous across all three panes.
- Moving focus in nav drives the diff; moving in the diff updates nav. Keep them coupled and obviously so.

### 4. Command palette (`⌘K`)
- A fuzzy-searchable overlay listing **every** action: mark done / skip, comment, open-in-editor, jump to a Chapter or Section by name, switch diff source, toggle nav, mark-complete.
- Each result shows its **current keyboard shortcut** inline, so the palette teaches the keymap as it's used.
- Design the empty state (recent / suggested actions) and the typing state (ranked fuzzy matches, including jumping straight to a named Chapter/Section).

### 5. Finishing — "done"
- When everything is accounted for, the user signals **done** — the review is complete and the agent may pick it up. There is no human "send": the agent collects the comments over `dispatch` (its sole egress) and composes any file/PR export itself.
- Design the **all-accounted** summary (N comments, N done, N skipped), the "done" affordance, and the terminal state that invites it.
- Also design **done when work *isn't* finished** (unreviewed Sections remain) — a clear, non-blocking confirmation, not a nag. The agent will still see what's open via the gap report.

---

## States & edge cases

Design every one of these. They are where the app feels finished or cheap:

- **Launch / loading** — the CLI has booted; the agent is reading the whole diff and proposing structure. This grouping step takes real time on a large diff. Design an honest, calm loading state (and consider showing the raw change count immediately, with structure resolving in).
- **Empty diff** — nothing changed. A clean, friendly "nothing to review."
- **Huge diff** — hundreds of changes across many Chapters. The nav tree and progress must stay legible and fast; design how density scales.
- **A Section with one change** vs **a Section spanning many files** — both common; both must read well.
- **"Other changes"** — the catch-all trailing Section. Present, slightly muted, never alarming.
- **Agent grouping is weak / generic** — sometimes the structure is mediocre and falls back toward git order. The UI must degrade gracefully and never look broken.
- **Re-review** — the user reviewed yesterday; the author pushed more commits; some previously-done Sections have **resurfaced as unreviewed** because their content changed. Design how resurfaced work is signalled — it should feel like "this came back because it genuinely changed," not like lost progress.
- **All done** — every Section accounted for. A genuinely satisfying terminal state that invites Go.

---

## Keyboard & focus model

- **A visible focus ring at all times**, unmistakable across nav and diff. The user should always know what a keypress will act on.
- **Single-key bindings for the hot path:** next / previous Section (`j`/`k` + arrows), **mark done & advance (`D`)**, **skip (`S`)**, comment, open file, toggle nav, toggle diff mode.
- **Contextual keys:** the same key does the obvious thing for whatever's focused.
- **Chords for global actions:** `⌘K` palette, pane toggles, Go.
- Bindings are **remappable**, and the palette always shows the current binding. Design a simple keyboard-shortcuts reference/cheat-sheet surface (a palette mode or an overlay).
- Voice dictation drops into the focused comment composer **without breaking keyboard flow** — designing that hand-off cleanly matters.

---

## macOS & appearance details

- Respect the system **light/dark** appearance and switch live with it.
- In the `--app` window: no browser chrome. Account for the macOS traffic-light controls (top-left) in the header layout — don't collide with them.
- Consider subtle macOS-native touches (vibrancy/translucency on side panels, native-feeling focus and selection colours) **without** faking native controls everywhere — it's still a custom UI.
- Honour `prefers-reduced-motion`: motion is functional, and must have a calm fallback.
- Accessibility: meet contrast in both themes; never rely on colour alone for add/remove/mark state; full keyboard operability is already a requirement, so reflect it in visible focus order.

---

## Design tokens to define

Define these as a token system (light + dark values), so the build can consume them directly. You own the actual values:

- **Colour** — background layers (app / panel / raised), text (primary / secondary / disabled), hairline borders, the single accent (+ its hover/active/focus), semantic add / remove / warn / info, mark states (unreviewed / done / skipped), syntax-highlight palette.
- **Typography** — UI family + scale (a small, deliberate set of sizes/weights), monospace family for code, line-heights for prose vs code.
- **Spacing** — a 4px-based scale; pane paddings; row heights for the nav tree and diff lines.
- **Radii, borders, elevation** — corner radii, hairline width, the (restrained) shadow/elevation steps.
- **Motion** — durations and easings for focus moves, mark transitions, palette open/close, pane collapse.

---

## Deliverables

- High-fidelity mockups of the **2-pane main view**, **light and dark**, at a representative window size — populated with a realistic medium-sized review.
- The **command palette** (empty + typing states).
- The **comment composer** (dictating, draft-review, committed-with-thread) **and an inline answer** beneath a question comment.
- Key **states**: loading/grouping, empty diff, all-done, resurfaced-after-change, "Other changes", a **partly-ticked Section**, **agent-tier / reviewer-label badges**, and the **AI summary** band.
- The **done** flow (all-accounted summary → done state).
- **Split vs unified** diff modes.
- The **token system** (colour/type/spacing/radii/motion), light + dark.
- A short **interaction spec** for focus movement and the core keyboard map.

---

## Explicitly out of scope

- **Mobile, tablet, and any responsive-down layout.** Desktop only.
- **Voice capture UI** — dictation is the OS's job; design only the text field it types into.
- **Auth / settings-heavy surfaces** — none in v1 beyond what a review needs.
- **Marketing / onboarding screens** — this is the working tool, not its landing page.
- **A persistent review history / audit log** — a likely later version, not this one.
