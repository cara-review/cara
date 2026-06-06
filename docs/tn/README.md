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
| [26-012](TN-26-012-anthropic-agent-adapter.md) | Real Claude (Sonnet) AgentPort adapter | plan | active | #18 |
| [26-013](TN-26-013-project-guidance-clear-diff-md.md) | Project guidance — clear-diff.md → InstructionsSource → AgentPort | plan | active | #26 |
| [26-015](TN-26-015-monaco-diff-surface.md) | Monaco-based diff surface | proposal | active | #27 |
| [26-016](TN-26-016-comments-composer-commentsink-port.md) | Comments, composer, CommentSink port, and Go dispatch | proposal | draft | #14 |
| [26-017](TN-26-017-bun-trpc-toolchain-transport.md) | Bun + tRPC toolchain and transport rework | proposal | draft | #23 |
| [26-019](TN-26-019-command-palette.md) | Web — ⌘K command palette | plan | active | #13 |
| [26-022](TN-26-022-chat-pane-chapter-qa.md) | Chat pane — chapter-level Q&A with the agent | proposal | draft | #15 |
