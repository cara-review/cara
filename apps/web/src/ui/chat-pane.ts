// Chat pane: chapter-level Q&A with the agent (ADR-0009, #15), distinct from durable
// line comments. The reviewer asks free-form questions about the focused Chapter ("is
// this backwards compatible?") and the agent reads that Chapter's changes to answer.
//
// Q&A is ephemeral: the transcript is pane-local (never persisted, ADR-0005) and is
// scoped to the focused Chapter — it clears when focus moves to another Chapter. The
// composer is built once (stable) so re-renders never discard in-progress text.
//
// The agent's answer is UNTRUSTED text (ADR-0004): rendered via textContent (the `el`
// factory), never innerHTML, never interpreted as markup or allowed to drive an action.
//
// Classes extend the pane's existing `chat__` block. (The `cd-` namespacing convention
// applies to DOM rendered inside Monaco's view zones, where generic class names collide
// with Monaco's own — this pane is a top-level aside, so the collision risk is absent.)

import { el } from "../dom.ts";
import type { AppState, AppStore } from "../store.ts";

export interface ChatPane {
  readonly node: HTMLElement;
  update(state: AppState): void;
}

export function createChatPane(store: AppStore): ChatPane {
  const scope = el("span", { class: "chat__scope" });
  const head = el("div", { class: "chat__header" }, [
    el("span", { class: "chat__title", text: "Chapter Q&A" }),
    scope,
  ]);
  const messages = el("div", { class: "chat__messages", attrs: { role: "log", "aria-live": "polite" } });
  const input = el("textarea", {
    class: "chat__input",
    attrs: { rows: "1", placeholder: "Ask about this Chapter…" },
  });
  const send = el("button", { class: "chat__send", text: "Ask", onClick: submit });
  const composer = el("div", { class: "chat__composer" }, [input, send]);
  const node = el("aside", { class: "chat" }, [head, messages, composer]);

  // The Chapter the conversation is bound to, and whether a question is in flight.
  let chapter: number | undefined;
  let pending = false;

  function syncComposer(): void {
    const disabled = pending || chapter === undefined;
    input.disabled = disabled;
    send.disabled = disabled;
  }

  function addMessage(role: "user" | "agent" | "error", text: string): HTMLElement {
    const message = el("p", { class: `chat__message chat__message--${role}`, text });
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  }

  function submit(): void {
    if (pending || chapter === undefined) return;
    const question = input.value.trim();
    if (question === "") return;
    const askedAbout = chapter;
    input.value = "";
    addMessage("user", question);
    const reply = addMessage("agent", "…");
    reply.classList.add("chat__message--pending");
    pending = true;
    syncComposer();

    store
      .ask(askedAbout, question)
      .then((result) => {
        reply.textContent = result.answer; // untrusted (ADR-0004): textContent, never markup
      })
      .catch((error: unknown) => {
        reply.textContent = error instanceof Error ? error.message : "Something went wrong.";
        reply.classList.add("chat__message--error");
      })
      .finally(() => {
        reply.classList.remove("chat__message--pending");
        pending = false;
        syncComposer();
        input.focus();
      });
  }

  // Enter sends; Shift+Enter inserts a newline (voice/long-form questions).
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  syncComposer();

  return {
    node,
    update(state) {
      const next = state.activeSection?.chapter;
      const focused = next !== undefined ? state.snapshot?.review.chapters[next] : undefined;
      scope.textContent = focused?.title ?? "";
      if (next !== chapter) {
        chapter = next; // Q&A is Chapter-scoped: a new focus starts a fresh conversation.
        messages.replaceChildren();
      }
      syncComposer();
    },
  };
}
