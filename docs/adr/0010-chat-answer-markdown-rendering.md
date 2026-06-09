---
status: accepted
---

# Chat answers rendered as a sanitized markdown subset

Background: TN-26-023. Approved by owner 2026-06-08 (clickable scheme-restricted links).

> **Carried forward under [ADR-0011](0011-cli-agent-protocol.md) (TN-26-026, Refs #47).**
> ADR-0011 supersedes ADR-0009 and removes the chat pane, but this rendering discipline
> survives intact — it now governs the **inline answer at the atom** rather than a chat
> message. "Chat answer" below reads as "comment answer"; every rule (agent emits markdown
> never HTML, raw-HTML-off render, sanitized allowlist, scheme-restricted links, plain error
> text) stands unchanged.

Amends **ADR-0009 §2**, which mandated chat answers be rendered as plain text (`textContent`, "never interpreted as markup"). This ADR permits rendering them as a sanitized markdown subset, without relaxing the untrusted posture.

## Context

- Chat answers are untrusted agent output (ADR-0009). They are rendered via `textContent`, so the model's markdown appears as literal `##`/`**`/`` ` `` and answers read poorly.
- The owner wants markdown formatting and shorter answers, on the explicit condition that **the agent never produces HTML** — only markdown, with the HTML produced by trusted client code.

## Decision

ADR-0009 §2's rendering clause is replaced by the following. Everything else in ADR-0009 (read-only, no tools, no state mutation, untrusted, ephemeral) and ADR-0004 stands.

1. **The agent emits markdown, never HTML.** Its output is still untrusted answer text; markdown is just its expected shape.
2. **The client renders markdown→HTML with raw HTML disabled.** Any literal HTML in the answer (`<script>`, `<img onerror=…>`, etc.) is escaped to text, never parsed. Only markdown *syntax* is interpreted, and only by the renderer — the agent's raw string is never assigned to `innerHTML`.
3. **The rendered output is sanitized** (defense-in-depth) to an allowlisted subset: headings, paragraphs, emphasis/strong, inline code, fenced code blocks, lists, blockquotes. **No images, no raw HTML, no script or event handlers.**
4. **Links are clickable but scheme-restricted** to `http(s)`/`mailto`, opened with `rel="noopener noreferrer"` (and `target="_blank"`); any other scheme (`javascript:`, `data:`, …) is dropped/neutralized. This keeps links useful; the manipulated-agent phishing path is mitigated by the scheme allowlist and bounded to answer-integrity.
5. **Error text stays plain** (`textContent`) — only successful answers go through the renderer.

## What does not change

- Untrusted posture, no tools, no actions, no review-state mutation (ADR-0009, ADR-0004).
- Q&A is still ephemeral and display-only; it never drives counts or completion.
- The boundary: the core returns a plain answer string; rendering is a web-adapter concern. No LLM/transport concept enters the domain.

## Consequences

- Real formatting in chat answers; the renderer (trusted) owns the markdown→HTML conversion.
- New residual risk: *formatting spoofing* (a manipulated agent rendering a convincing fake heading/emphasis). Bounded to answer-integrity — the answer was never authoritative — and accepted, consistent with the #33 chat residuals.
- A markdown-rendering dependency enters the web bundle, configured raw-HTML-off + sanitized; covered by a security review and an e2e test that an answer containing raw HTML/script is shown as text, never executed.

## Rejected

- **Keep plain text; instruct the agent to avoid markdown** — fixes the literal-`##` symptom and shortens answers with zero security change, but the owner wants genuine formatting.
- **Let the agent emit HTML directly** — hands untrusted output an HTML channel; the whole point is that only trusted client code produces HTML.
- **Inert (non-clickable) links** — safest, but the owner chose clickable scheme-restricted links for usability; the residual phishing path is mitigated by the `http(s)`/`mailto` allowlist + `rel="noopener"` and is bounded to answer-integrity.
