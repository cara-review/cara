# Contributing

Thanks for looking. cara is pre-release and moves fast; this is the short version.

## Setup

```bash
bun install
./scripts/install-git-hooks.sh   # installs the pre-push quality gate
```

[Bun](https://bun.sh) ≥ 1.3 is the toolchain (CDR-0001) — runtime, test runner, bundler, package manager.

## Workflow — trunk-based

Changes land directly on `main`; there are no feature-branch PRs to merge. Run the quality gate before pushing:

```bash
bun run lint
bun run test       # typecheck + unit
bun run test:e2e   # Playwright
```

The git **pre-push hook** runs all three and is the gate. **Never bypass it with `--no-verify`.**

## Commits

Conventional commits, scoped: `feat(core): …`, `fix(web): …`, `docs(adr): …`. Reference issues with `Refs #N` (or `Closes #N`).

## Architecture is load-bearing

The hexagonal boundaries ([ADR-0003](docs/adr/0003-hexagonal-architecture.md)), the agent-untrusted master-list invariant ([ADR-0004](docs/adr/0004-agent-untrusted-master-list.md)), and the CLI agent protocol ([ADR-0011](docs/adr/0011-cli-agent-protocol.md)) are ratified and strict.

- The core (`packages/core`) is pure: no IO, no adapter concepts (git SHAs, fs paths, HTTP/WS, an LLM's shape) in domain types or names. The core is **LLM-free**.
- The two layers — mechanical (git atoms) and semantic (agent grouping) — never mix.
- **Deviating** from an accepted ADR — crossing a layer, adding a port or cross-boundary channel, relaxing TS strictness — requires a new ADR (born from a TN, `kind: proposal`) and **explicit owner approval first**. Until then, stop and surface the question.

## Docs

Code change that affects docs → update them in the same change. Proposals, specs, and plans live as numbered **Technical Notes** in [`docs/tn/`](docs/tn/) (index in its README); ratified decisions become **ADR**s (`docs/adr/`) or **CDR**s (`docs/cdr/`). [`docs/concept.md`](docs/concept.md) is the product source of intent.

## Licence

By contributing you agree your contributions are licensed under the MIT License ([`LICENSE`](LICENSE)).
