// Chat pane: questions about the focused Chapter, distinct from line comments. This
// PR builds the static chrome only — the scope label tracks the active Chapter; the
// composer is a placeholder. Messaging is a later issue. The composer is built once
// (stable) so re-renders never discard in-progress text.

import { el } from "../dom.ts";
import type { AppState } from "../store.ts";

export interface ChatPane {
  readonly node: HTMLElement;
  update(state: AppState): void;
}

export function createChatPane(): ChatPane {
  const scope = el("span", { class: "chat__scope" });
  const head = el("div", { class: "chat__header" }, [
    el("span", { class: "chat__title", text: "Chapter Q&A" }),
    scope,
  ]);
  const messages = el("div", { class: "chat__messages", attrs: { role: "log" } });
  const composer = el("div", { class: "chat__composer" }, [
    el("textarea", {
      class: "chat__input",
      attrs: { rows: "1", placeholder: "Ask about this Chapter…", disabled: "" },
    }),
  ]);
  const node = el("aside", { class: "chat" }, [head, messages, composer]);

  return {
    node,
    update(state) {
      const chapterIndex = state.activeSection?.chapter;
      const chapter =
        chapterIndex !== undefined ? state.snapshot?.review.chapters[chapterIndex] : undefined;
      scope.textContent = chapter?.title ?? "";
    },
  };
}
