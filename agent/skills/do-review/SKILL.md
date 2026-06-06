---
name: do-review
description: Pre-ship review scaled to the risk of the change. Selects the right reviewers, applies findings inline, and produces an issue comment summary. Run before do-ship.
disable-model-invocation: false
---

# do-review

You are a thorough, experienced code reviewer. Getting it right matters more than getting it done. Findings are applied inline before `do-ship`, not noted for later.

## Triggers

`/do-review`, "review my changes", "check the architecture", "review this"

---

## Stage 1 — Read the diff and classify risk

Read the full diff and any context needed (changed files, related tests, impacted interfaces).

| Risk level       | Criteria                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Trivial**      | Docs, comments, config, text, annotations only                                         |
| **Standard**     | Single domain, clear scope, no security/auth/ports touched                             |
| **Architecture** | New abstractions, layer changes, cross-cutting, ports, new patterns or complex feature |
| **Security**     | Auth, crypto, permissions, data handling, wire format, external inputs                 |

A change can be both Architecture and Security — run both reviewers.

---

## Stage 2 — Select and invoke reviewers

### How reviewers run

Reviewers are **agents**, not inline work. Invoke each via the **Agent tool** with `subagent_type` set to the agent name — every reviewer runs in its **own clean, isolated context** with no view of this conversation. Their definitions live in `agent/agents/<name>.md`.

- **Model is built into each agent definition** — you do not pick one. Pass the Agent tool's `model` argument only to **override**, and only where noted below.
- **Spawn concurrently** — issue multiple Agent calls in one message so reviewers run in parallel.
- Each agent's final message is its findings. Collect them all before Stage 3.

### The reviewers

**Architect** — `subagent_type: "architect"` (model `opus`, built in)

> Hexagonal architecture compliance, layer boundary violations, naming consistency, separation of concerns, duplication, structural patterns.
> Hard stop if findings require an ADR.

**Security analyst** — `subagent_type: "security-analyst"` (model `opus`, built in)

> OWASP top 10, input validation, secret handling, auth/crypto correctness, dependency risk.
> Hard stop if findings require an ADR. **Override** to `model: "sonnet"` for standard (non-auth/crypto) checks.

**Code quality reviewer** — `subagent_type: "code-quality"` (model `sonnet`, built in)

> Clarity, readability, unnecessary complexity, dead code.

**Test coverage reviewer** — `subagent_type: "test-coverage-agent"` (model `opus`, built in)

> A meticulous TDD advocate that hunts the untested edge case. Read-only: it returns a precise description of a test that would **fail** against the current implementation, proving a real domain bug. Its headline finding is a failing test, not a coverage number.

**Domain language reviewer** — `subagent_type: "ubiquitous-language"` (model `sonnet`, built in)

> Naming consistency with the domain model.

### Selection

| Risk level   | Reviewers (`subagent_type`)                              |
| ------------ | -------------------------------------------------------- |
| Trivial      | Self-review only — no agents                             |
| Standard     | `architect`                                              |
| Architecture | `architect`                                              |
| Security     | `architect` + `security-analyst`                         |

Add `test-coverage-agent` or `ubiquitous-language` when the diff warrants it. Spawn them in the same parallel batch.

Lean on being more rigorous than fast. Quality is valued over speed in all cases.

---

## Stage 3 — Apply findings

**Enumerate first.** Before writing any code, list every finding from every reviewer with a disposition: **Implement / Disagree / Defer**. The summary must account for all of them.

- **Implement** — default. No justification needed.
- **Disagree** — finding is wrong, inapplicable, or based on a misread. State reasoning in the summary.
- **Defer** — only when applying the finding would expand the diff _significantly outside_ the files already touched, or require architectural changes not in the original plan. Renames, extractions, restructuring, or non-trivial rewrites _within_ the touched files do not qualify — those are in scope. Create a follow-up issue and note the gap in the summary.

Severity is not a disposition. A "Low" finding inside touched files is Implement. "It's only a medium" and "we can do it later" are not valid reasons to defer.

**Full rework escalation** — if the architect reviewer concludes that the implementation is so fundamentally misaligned (wrong layer, wrong pattern, wrong approach) that fixing individual findings would produce worse code than starting fresh:

Do not enumerate findings. Instead:

1. State clearly: "Architect review: full rework required — [one-paragraph reason]."
2. Post this as an issue comment.
3. Set issue status back to **Ready**.
4. **Autonomous mode:** report to the team lead via `SendMessage`: "Review failed on #N — full rework required. [reason]. Shutting down." Then shut down — do not attempt fixes.
5. **Manual mode:** tell the developer: "The architect reviewer recommends a fresh approach to this issue. The current implementation [reason]. The issue has been reset to Ready — please reconsider the design before picking it up again."

Do not merge partial fixes with a fundamentally flawed implementation. A clean restart is faster than patching the wrong foundation.

---

**Hard stop — ADR required** if the diff:

- Deviates from hexagonal architecture (business logic outside domain, bypassed ports, wrong layer coupling)
- Touches security model invariants
- Introduces a structural pattern not established in the codebase

**Hard stop — CDR required** if the diff breaks an existing coding convention without a record in `docs/cdr`

Either case, rewrite to comply with existing architecture/conventions or raise with user before proceeding (Status: Needs Human). Do not ship.

---

## Stage 4 — Documentation review

Refer to the repository's main instructions (root `CLAUDE.md` / `AGENT.md` / equivalent) for documentation locations and conventions.

For each doc area the repo declares: does the diff add, remove, or change something it describes? If yes, update it in the same change.

Do not ship with stale documentation.

---

## Stage 5 — Review marker + summary

Write the review marker so push gates know review has passed:

```bash
mkdir -p .agent-state
jq -n --arg sha "$(git rev-parse HEAD)" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg risk "$RISK" \
  '{sha: $sha, timestamp: $ts, risk: $risk}' > .agent-state/last-review.json
```

Then post to the issue:

```
Risk: [Trivial / Standard / Architecture / Security]
Reviewers: [list]
Findings applied: [list or "none"]
Findings disagreed with: [finding + reason, or "none"]
Follow-up issues created: [list or "none"]
Docs updated: [list or "none"]
```

---

## Rules

- **Every finding gets a disposition: Implement / Disagree / Defer.** Default is Implement. Defer only when applying would significantly expand the diff outside touched files or require unplanned architectural changes — not for severity, not for "later". Disagree requires reasoning in the summary.
- Architect always uses `model: opus`
- ADR/CDR escalation is a hard stop — no exceptions
- Documentation must be updated before shipping — stale docs are a bug
- Summary always posted, even for trivial ("self-reviewed, clean")
