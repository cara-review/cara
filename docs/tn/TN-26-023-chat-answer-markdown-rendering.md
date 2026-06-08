---
number: 26-023
title: Chat answers rendered as a sanitized markdown subset
kind: proposal
status: active
issue: "#37"
tags: [chat, agent, security, rendering, untrusted, markdown, hexagonal]
---

# TN-26-023: Chat answers rendered as a sanitized markdown subset

The chat Q&A pane renders the agent's answer via `textContent` (ADR-0009 §2: untrusted, "never interpreted as markup"), so the model's markdown shows as literal `##`, `**`, and `` ` ``. The owner wants real formatting and shorter answers. Background for **ADR-0010**.

## Why this is an architecture gate, not a feature

ADR-0009 §2 is explicit: *"Output is untrusted: escape on render, `textContent` never `innerHTML`, never interpreted as markup or action."* Rendering markdown means interpreting the agent's untrusted output as markup — a direct reversal of a ratified decision. Per CLAUDE.md › Architecture policy this needs an ADR and explicit owner approval before any code.

## The safe shape (owner framing, 2026-06-08)

The trust boundary is **the agent never produces HTML; trusted client code does the markdown→HTML conversion**:

- The agent emits **markdown text only** — still untrusted, still read-only, still no tools (ADR-0009 unchanged on those).
- The client renders markdown→HTML with **raw HTML disabled**: any literal HTML (e.g. `<script>`, `<img onerror=…>`) in the answer is escaped to text, never parsed. Only markdown *syntax* is interpreted, and only by our renderer.
- The rendered output is **sanitized** (defense-in-depth) to an allowlisted subset; the result is assigned via the renderer's element construction, not by handing the agent's raw string to `innerHTML`.

### Allowed subset

Headings, paragraphs, emphasis/strong, inline code, fenced code blocks, lists, blockquotes. **No images** (no need; avoids remote-fetch tracking/SSRF). **No raw HTML.** **No script/event handlers.**

### Links (resolved: clickable, scheme-restricted)

A manipulated diff could steer the agent to emit a phishing link. Owner chose **clickable links restricted to `http(s)`/`mailto`, opened with `rel="noopener noreferrer"`**; any other scheme (`javascript:`, `data:`, …) is dropped. The residual one-click phishing path is mitigated by the allowlist and bounded to answer-integrity.

## Threat model / residual risk

Bounded to **answer-integrity only** — consistent with the #33-accepted chat residuals (F1/F2/F3). Q&A is display-only: it can't act, mutate review state, or drive completion (ADR-0004/0009 intact). The new residual is *formatting spoofing*: a manipulated agent could render a convincing fake heading ("✓ Approved") or emphasis. This is no more authoritative than today's plain text — the answer was never trustworthy — and the reviewer reads it as one answer in a Q&A pane, not as review state. Accepted.

## Plan

1. **ADR-0010** amends ADR-0009 §2 (this TN is its background).
2. Renderer in `apps/web/src/ui/chat-pane.ts`: markdown→HTML with raw HTML disabled + output sanitized; links inert; error text stays on `textContent`.
3. `CHAT_SYSTEM_PROMPT`: brief answers (a few sentences); light markdown where it genuinely helps.
4. **Security review** of the untrusted-output rendering; **e2e** asserting an answer containing raw HTML/script is shown as text, never executed (mirrors the existing summary-escaping test).

## Status

Approved by owner 2026-06-08; ratified as ADR-0010 (links clickable, scheme-restricted).
