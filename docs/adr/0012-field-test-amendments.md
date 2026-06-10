---
status: accepted
amends: [0004, 0011]
---

# Field-test amendments: validated summaries, line-anchored comments, Reshape, single-server lifecycle

Background: TN-26-026 (the pivot), field-tested in-session. Owner-approved in-session 2026-06-10 (Refs #47). Narrows ADR-0004's repair model and adds three channels to the ADR-0011 protocol. Methodology sizing is versioned methodology text, **not** an ADR decision — referenced below for traceability only.

## Decision

### 1. Repair structure, validate summaries (amends ADR-0004)

- ADR-0004's **"repair, don't retry"** holds for **structure** only. The engine repairs a grouping back to the canonical set (the bijection); it **cannot author semantics** — the prose that orients a reviewer is the agent's to write.
- **Summaries are mandatory.** `present` **rejects** a grouping with a missing or empty summary on any chapter or section, returning the missing list (gap-report style). The agent completes the summaries and re-presents. (Supersedes ADR-0004's "optional descriptive summaries".)
- **The git-order floor is exempt.** The engine-generated floor (ADR-0002) claims no semantics, carries no summaries, and is never rejected — the never-broken, always-usable guarantee holds. Validation gates only agent-authored groupings.
- Rule: **repair structure, validate summaries.**

### 2. Line-anchored comments (amends ADR-0011)

- A comment anchors to its **atom** (by hash — unchanged, ADR-0002/0007) plus an **optional within-hunk line pointer**.
- The pointer is stored by **line content + side** (added | removed), **never by line number** — the same identity rule as marks (ADR-0002). It is **display metadata only**: it never splits an atom, never becomes a mechanical unit, never affects the bijection or counts.
- **Marks stay block-level** (on the atom). The pointer only refines *where in the hunk* a comment renders.
- **Fallback:** when the pinned line is absent from the current payload, the comment renders at the **end of the hunk**. In-session this effectively never fires — the line is present while the comment is open.

### 3. Reshape — a review-level request channel (amends ADR-0011)

- **Reshape** is a **review-level, non-atom-anchored** request: the human describes a desired view in natural language; the engine routes it to the agent via `dispatch`; the agent **re-presents** a new grouping. Marks ride along free (ADR-0002).
- It covers:
  - **regrouping** — "split the tests out", "group by subsystem";
  - **filtering** — "show only the public-interface changes" → a focused chapter plus a trailing "Rest of the change" swept by the bijection (no atom is hidden);
  - **question-answered-as-a-view** — the answer arrives as a grouping whose summary carries the verdict.
- The **comment stream stays code-only.** Reshape is a separate channel, not a comment — the ADR-0011 comment model (freeform-in / structured-out, atom-anchored) is unchanged.

### 4. One live server per context (amends ADR-0011)

- A context has **at most one live server.** `present` with a new grouping **routes into the existing live server** (live-refresh over WS, marks intact) rather than booting a sibling.
- A stale server is **replaced, never left to coexist** — two servers never serve the same context at once.

## Not an ADR decision — methodology sizing

Section sizing is **versioned methodology text** (`SYSTEM_METHODOLOGY` / `METHODOLOGY_VERSION`), not an architectural decision; recorded here only for traceability. The rule: sections are sized by **cognitive load** — roughly 1–2 pages of *varied* diff. A long *homogeneous* run (e.g. a mechanical rename) staying in one section is explicitly fine. Never fragment repetition; never let varied change run long.

## Consequences

- `present` / `repairGrouping` gains a summary-presence gate, distinct from bijection repair; the git-order floor path bypasses it.
- A comment's optional line pointer is overlay display data (content + side), under the same untrusted-overlay discipline as summaries (ADR-0004 / 0010).
- `dispatch` carries Reshape requests outbound to the agent alongside comments and progress; the agent's response is a fresh `present`.
- Server management is single-instance-per-context; `present` is idempotent over an existing server (refresh, not spawn).
