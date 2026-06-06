// UI composition root. Builds the transport → RPC → store → view chain and connects.
// One same-origin WebSocket: the backend serves this UI and the WS on one port, so we
// derive the URL from `location` (a `?ws=` override exists only for dev against a
// separately-run backend). #12 mounts the diff surface onto `view.mount` using `store`.

import "./styles.css";
import { RpcClient, WebSocketTransport } from "./rpc.ts";
import { AppStore } from "./store.ts";
import { createView } from "./view.ts";

function backendUrl(): string {
  // The `?ws=` override is a dev-only affordance (point the UI at a separately-run
  // backend); it is stripped from production builds, which always use same-origin.
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(window.location.search).get("ws");
    if (override !== null && override !== "") return override;
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/`;
}

const root = document.querySelector<HTMLDivElement>("#app");
if (root !== null) {
  const transport = new WebSocketTransport(backendUrl());
  const store = new AppStore(new RpcClient(transport));
  const view = createView(root, store);
  store.subscribe(() => view.render(store.getState()));
  store.bindTransport(transport);
  view.render(store.getState()); // initial paint: connecting
}
