---
number: 26-001
title: Technical Notes and documentation structure
kind: proposal
status: active
issue: "#3"
tags: [documentation, process, meta]
---

# TN-26-001: Technical Notes and documentation structure

> Eats its own dogfood: this is the first TN, in the new location, in the new format.

## Style — applies to every TN

- Compact. Bulleted. Get to the point.
- No long prose paragraphs. No meandering examples.
- One sentence per bullet where possible.
- If a section needs more than ~20 lines, it probably needs splitting or cutting.
- This rule applies to this TN too.

## Decision

Three doc types, three roles:

- **Technical Notes (TNs)** under `docs/tn/` — numbered timeline of proposals, specs, plans, explorations, research. The working surface where ideas develop.
- **Architectural Decision Records (ADRs)** under `docs/adr/` — ratified architectural decisions.
- **Convention Decision Records (CDRs)** under `docs/cdr/` — ratified conventions (style, structure, tooling).

TN stack = working surface. ADRs/CDRs = ratified output.

Layout is flat (`docs/adr/`, `docs/cdr/`, `docs/tn/` as siblings), matching the existing ADRs already at `docs/adr/`.

### TNs do NOT replace

- `docs/adr/` — ratified architectural decisions
- `docs/cdr/` — ratified convention decisions
- Inline code docs
- `CLAUDE.md`

### Numbering

- Format: `TN-YY-NNN`, e.g. `TN-26-001`.
- Counter resets each calendar year.
- File: `TN-YY-NNN-slug.md`.
- ADRs and CDRs use `NNNN` zero-padded, no year reset (`docs/adr/0001-slug.md`).

### Front matter (TN)

```yaml
---
number: 26-001
title: Short descriptive title
kind: proposal | spec | plan | exploration | research
status: draft | active | superseded
issue: "#3"                   # required at commit time
superseded-by: [26-045]       # optional
tags: [documentation, process] # optional
---
```

- `issue` is **required** at commit time. Only `TBD` allowed on uncommitted local copies.
- `kind` — closest fit, not a hard taxonomy.
- `status` is the only field that determines authority.

### `kind` values

- `proposal` — recommends an approach
- `spec` — defines requirements or a design
- `plan` — implementation steps for a scope of work
- `exploration` — open-ended investigation, may lead nowhere
- `research` — background research on a tech, model, or pattern

### `status` values

- `draft` — work in progress, not authoritative
- `active` — agreed and current, treat as authoritative
- `superseded` — historical, follow `superseded-by`

### Plans are TNs

- All planning output (e.g. from `do-plan`) is a TN with `kind: plan`, not a loose plan file.
- The plan TN is the first commit on its ticket; the implementation commits follow on the same ticket.

### Numbering workflow

A TN is born from an issue. The reservation commit is the **first commit on that ticket**.

1. Open the GitHub issue.
2. Pick the next free TN number from `docs/tn/README.md`.
3. Create the file with front matter (`status: draft`, `issue: "#NNN"`) and a title heading. Body can be a single TODO line.
4. Commit + push as the first commit on the ticket. Number is now reserved.
5. Flesh out in subsequent commits on the same ticket.
6. Promote to `active` when ready.

Push races are caught by the pre-push hook — rebase, bump number, re-push.

### Numbers under parallel agents

When a team coordinator runs multiple agents concurrently, the coordinator **pre-allocates a distinct TN number to each agent** before they start, so two agents never reserve the same number. The coordinator owns the allocation and keeps `docs/tn/README.md` reconciled.

### Supersession

1. Add `superseded-by: [YY-NNN]` to the older TN.
2. Set the older TN's `status: superseded`.
3. Add a one-line banner at the top of the older TN body.
4. New TN references the old one for context.

### Promotion to ADR/CDR

1. Write the ADR/CDR under `docs/adr/` or `docs/cdr/`.
2. ADR/CDR references the TN as background.
3. TN gets `superseded-by: [ADR-XXXX]` and `status: superseded`.

### Agent guidance

Read the `status` field before treating any TN as authoritative.

- `active` → authoritative
- `draft` → context only, not approved
- `superseded` → historical, follow the pointer

## Test plan

- Every file in `docs/tn/` has `number`, `title`, `kind`, `status`, `issue`.
- `number` matches filename prefix.
- `status` ∈ {draft, active, superseded}.
- `kind` ∈ {proposal, spec, plan, exploration, research}.
- `docs/tn/README.md` lists every TN file on disk.
