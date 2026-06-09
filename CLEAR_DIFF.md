# clear-diff — project review guidance

Reviewer guidance for changes to clear-diff itself. Steers how the diff is grouped into Chapters and Sections — what leads, what gets relegated. Project layer; pairs with anyone's personal `~/.clear-diff.md`.

## Lead with these

The architecture is load-bearing and ratified. Surface anything touching it first.

- **Hexagonal boundary violations** — the domain (`packages/core`) depending on an adapter, a layer crossing the wrong way, a port skipped. Top chapter.
- **Adapter-concept leakage into the domain** — a concept true for one adapter but not all (git hunks/SHAs/diff headers, filesystem paths, HTTP/WS framing, an LLM's response shape, GitHub PR fields) appearing in domain types, names, or logic. Hard violation, treat like a layer breach. Ports translate adapter reality into domain-neutral terms.
- **The two layers must never mix** — mechanical (git hunks, stable, deterministic; the master list owns identity) vs semantic (Chapters/Sections, fluid, disposable, regrouped every run). Flag either contaminating the other.
- **The agent-untrusted master-list invariant** (ADR-0004) — grouping is structure-only; the agent never originates atoms, never sees authority over the canonical list. Flag any path letting agent output reach the UI without repair.
- **Port and type seam changes** — new ports, changed port interfaces, relaxed TS strictness. These often need an ADR; chapter them prominently.

## Relegate these

- Test, fixture, and snapshot churn — keep in their own low-priority Section, away from the domain changes they cover.
- Docs (`docs/`, `*.md`) — group separately; relevant but rarely the headline.
- Formatting-only / import-ordering noise — collapse into one Section.

## Vocabulary

- User-facing groupings are **Chapters** (major tranche of intent) and **Sections** (curated related change within a chapter).
- "atom" and "hunk" are internal plumbing — never surface them in user-facing output. The mechanical unit is one git hunk; users only ever see Chapters and Sections.
