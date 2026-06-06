// View orchestrator: builds the 3-pane shell skeleton once and updates regions on
// each store change. The diff and chat panes keep stable nodes (the diff mount is
// #12's surface); the header, nav, and status bar re-render from state. A whole-window
// overlay (loading / empty / disconnected / error) replaces the grid when there is no
// review to show.

import { el, fill } from "./dom.ts";
import { header } from "./ui/header.ts";
import { renderNav } from "./ui/nav.ts";
import { createDiffPane } from "./ui/diff-pane.ts";
import { createChatPane } from "./ui/chat-pane.ts";
import { overlay } from "./ui/states.ts";
import type { AppState, AppStore } from "./store.ts";

export interface View {
  readonly mount: HTMLElement;
  render(state: AppState): void;
}

export function createView(root: HTMLElement, store: AppStore): View {
  const headerHost = el("div", { class: "header-host" });

  const diffPane = createDiffPane();
  const chatPane = createChatPane();
  const navEl = el("nav", { class: "nav" });
  const grid = el("div", { class: "grid" }, [navEl, diffPane.node, chatPane.node]);

  const overlayHost = el("div", { class: "overlay-host" });
  const statusHost = el("footer", { class: "status" });

  const app = el("div", { class: "app" }, [headerHost, grid, overlayHost, statusHost]);
  root.replaceChildren(app);

  return {
    mount: diffPane.mount,
    render(state) {
      fill(headerHost, header(state));

      const screen = overlay(state);
      grid.hidden = screen !== null;
      fill(overlayHost, screen);

      if (screen === null) {
        renderNav(navEl, state, store);
        diffPane.update(state);
        chatPane.update(state);
      }

      fill(statusHost, statusBar(state));
    },
  };
}

function statusBar(state: AppState): HTMLElement {
  const dot = el("span", { class: `status__dot status__dot--${state.connection}`, attrs: { "aria-hidden": "true" } });
  const connection = el("span", { class: "status__connection", text: connectionLabel(state.connection) });
  const counts =
    state.snapshot !== null
      ? el("span", {
          class: "status__counts",
          text: `${state.snapshot.progress.addressed}/${state.snapshot.progress.total} changes reviewed`,
        })
      : null;
  return el("div", { class: "status__bar" }, [
    el("div", { class: "status__group" }, [dot, connection]),
    counts,
  ]);
}

function connectionLabel(connection: AppState["connection"]): string {
  switch (connection) {
    case "connecting":
      return "Connecting…";
    case "open":
      return "Connected";
    case "closed":
      return "Disconnected";
    case "error":
      return "Connection error";
  }
}
