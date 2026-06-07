// A deterministic AgentChat for the Q&A e2e (ADR-0009). Its answer carries an
// HTML-injection probe so the suite can prove the chat pane renders the agent's
// answer as inert text (ADR-0004), never as markup. If escaping ever regressed, the
// injected <img> would fire onerror and set window.__chatXss.

import type { AgentChat, ChatRequest } from "@clear-diff/core";

export const CHAT_XSS_PROBE = `<img src=x onerror="window.__chatXss = true">`;

export class AnsweringAgent implements AgentChat {
  answer(request: ChatRequest): Promise<unknown> {
    return Promise.resolve({
      answer: `Re "${request.question}": this Chapter has ${request.atoms.length} change(s). ${CHAT_XSS_PROBE}`,
    });
  }
}
