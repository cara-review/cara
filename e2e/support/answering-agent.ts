// A deterministic AgentChat for the Q&A e2e (ADR-0009/0010). Its answer exercises the
// sanitized markdown renderer: real markdown (**bold**, a safe link), a disallowed
// javascript: link that must be neutralized, and a raw-HTML injection probe that must
// be escaped to text. If the renderer's guards regressed, the <img> would fire onerror
// and set window.__chatXss, or the javascript: link would survive.

import type { AgentChat, ChatRequest } from "@clear-diff/core";

export const CHAT_XSS_PROBE = `<img src=x onerror="window.__chatXss = true">`;

export class AnsweringAgent implements AgentChat {
  answer(request: ChatRequest): Promise<unknown> {
    return Promise.resolve({
      answer: [
        `Re "${request.question}": this Chapter has ${request.atoms.length} change(s).`,
        ``,
        `**Bold note.** See [safe](https://example.com) and [bad](javascript:alert(1)).`,
        ``,
        // Markdown image syntax (distinct from raw-HTML <img>): reaches DOMPurify, which
        // must drop it (FORBID_TAGS). The chat-img count assertion covers both paths.
        `![track](https://evil.example/pixel.gif)`,
        ``,
        CHAT_XSS_PROBE,
      ].join("\n"),
    });
  }
}
