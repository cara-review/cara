// UI composition root. Builds the backend → store → view chain and connects. One
// same-origin WebSocket: the backend serves this UI and the WS on one port, so the
// URL is derived from `location`. #12 mounts the diff surface onto `view.mount`.

import "./styles.css";
import { createBackend } from "./backend.ts";
import { AppStore } from "./store.ts";
import { createView } from "./view.ts";
import { createDiffSurface } from "./ui/diff-surface.ts";
import { createCommandPalette } from "./ui/command-palette.ts";
import { installKeyboard } from "./ui/keyboard.ts";

function backendUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/`;
}

const root = document.querySelector<HTMLDivElement>("#app");
if (root !== null) {
  const store = new AppStore(createBackend(backendUrl()));
  const view = createView(root, store);
  const surface = createDiffSurface(view.mount, store);
  store.subscribe(() => {
    view.render(store.getState());
    surface.render(store.getState());
  });
  installKeyboard(store, createCommandPalette(document.body, store, surface), surface);
  store.connect();
  view.render(store.getState()); // initial paint: connecting (surface is empty until a review opens)
  surface.render(store.getState());
}
