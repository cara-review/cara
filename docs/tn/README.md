# Technical Notes

Numbered timeline of proposals, specs, plans, explorations, and research. The working surface where ideas develop before they're ratified into an [ADR](../adr/) or [CDR](../cdr/). See [TN-26-001](TN-26-001-technical-notes-and-doc-structure.md) for the system itself.

Read the `status` field before treating any TN as authoritative: `active` → authoritative, `draft` → context only, `superseded` → follow the pointer.

| TN | Title | Kind | Status | Issue |
|---|---|---|---|---|
| [26-001](TN-26-001-technical-notes-and-doc-structure.md) | Technical Notes and documentation structure | proposal | active | #3 |
| [26-002](TN-26-002-monorepo-scaffold.md) | Monorepo scaffold and strict TypeScript toolchain | plan | active | #4 |
| [26-003](TN-26-003-core-domain-and-ports.md) | Core domain — atoms, identity, master list, grouping, marking, and all ports | plan | active | #5 |
| [26-004](TN-26-004-gitcli-diffsource-workspacereader.md) | GitCli adapters — DiffSource and WorkspaceReader | plan | active | #6 |
| [26-005](TN-26-005-reviewstore-jsonl-event-log.md) | Adapter — ReviewStore append-only JSONL event log | plan | active | #7 |
| [26-006](TN-26-006-fake-agent-and-trivial-adapters.md) | FakeAgent and trivial driven adapters | plan | active | #8 |
| [26-007](TN-26-007-review-service-use-cases.md) | Application — ReviewService use-cases | plan | active | #9 |
| [26-008](TN-26-008-backend-server-and-cli.md) | Backend — HTTP/WS server, composition root, and clear-diff CLI | plan | active | #10 |
| [26-009](TN-26-009-web-shell.md) | Web — app shell, 3-pane layout, nav tree, WS client + state store | plan | active | #11 |
| [26-010](TN-26-010-web-diff-surface.md) | Web — diff surface, marking, keyboard navigation | plan | active | #12 |
| [26-011](TN-26-011-e2e-playwright-suite.md) | End-to-end Playwright test suite | plan | active | #22 |
| [26-012](TN-26-012-anthropic-agent-adapter.md) | Real Claude (Sonnet) AgentPort adapter | plan | superseded (→26-026) | #18 |
| [26-013](TN-26-013-project-guidance-clear-diff-md.md) | Project guidance — clear-diff.md → InstructionsSource → AgentPort | plan | superseded (→26-026) | #26 |
| [26-015](TN-26-015-monaco-diff-surface.md) | Monaco-based diff surface | proposal | active | #27 |
| [26-016](TN-26-016-comments-composer-commentsink-port.md) | Comments, composer, CommentSink port, and Go dispatch | proposal | superseded (→26-026) | #14 |
| [26-017](TN-26-017-bun-trpc-toolchain-transport.md) | Bun + tRPC toolchain and transport rework | proposal | active | #23 |
| [26-018](TN-26-018-diff-surface-toggles.md) | Diff-surface toggles — split/unified and show-all-diffs | plan | active | #16, #28 |
| [26-019](TN-26-019-command-palette.md) | Web — ⌘K command palette | plan | active | #13 |
| [26-020](TN-26-020-pane-resize-collapse-persisted-layout.md) | Pane resize / collapse + persisted layout | plan | active | #17 |
| [26-021](TN-26-021-edge-state-polish.md) | Edge-state polish — connection lifecycle, empty, all-done | plan | active | #19 |
| [26-022](TN-26-022-chat-pane-chapter-qa.md) | Chat pane — chapter-level Q&A with the agent | proposal | superseded (→26-026) | #15 |
| [26-023](TN-26-023-chat-answer-markdown-rendering.md) | Chat answers rendered as a sanitized markdown subset | proposal | active | #37 |
| [26-024](TN-26-024-cross-runtime-server.md) | Cross-runtime server runtime — Node-portable transport for native npx | proposal | active | #42 |
| [26-025](TN-26-025-competitive-landscape-and-positioning.md) | Competitive landscape and positioning — agent-grouped, completeness-gated diff review | research | active | #46 |
| [26-026](TN-26-026-cli-agent-protocol-pivot.md) | CLI agent protocol pivot — external agent supplies grouping, dual-mode, LLM-free core | proposal | active | #47 |
| [26-027](TN-26-027-pivot-implementation-plan.md) | Pivot implementation plan — LLM-free core, CLI agent protocol, dual-mode | plan | active | #47 |
| [26-028](TN-26-028-polish-pass-implementation-plan.md) | Polish-pass implementation plan — field-test findings on the pivot | plan | active | #47 |
| [26-029](TN-26-029-ab-eval-scaffolded-vs-freeform.md) | A/B evaluation — scaffolded (clear-diff) vs freeform review (first eval datapoint) | research | active | #47 |
| [26-030](TN-26-030-boundary-lens-engine-computed.md) | Engine-computed boundary lens — a deterministic between-atom view for the seams pass | proposal | draft | #47 |
| [26-031](TN-26-031-review-ledger-pivot.md) | Review-ledger pivot — review as a durable, role-attributed, gatable repo fact | proposal | draft | #47 |
| [26-032](TN-26-032-cara-prior-art-survey.md) | CARA prior-art survey — does a content-addressed review attestation already exist? | research | active | #47 |
| [26-033](TN-26-033-ai-review-gate-market-scan.md) | AI review-gate market scan — is "gate that an agent reviewed my code" already solved? | research | active | #47 |
