// The transport server (ADR-0003, ADR-0008 + its 2026-06-08 amendment): the driving
// adapter that carries the tRPC router over one WebSocket and serves the built UI over
// HTTP. Cross-runtime — node:http + `ws` + node:fs — so the published bundle runs under
// plain Node (npx) and under Bun alike. Binds 127.0.0.1 only (ADR-0001). A loopback bind
// is still reachable cross-origin from any page in the user's browser, so both HTTP and
// the WS upgrade enforce a loopback Origin + Host allowlist (CSRF / DNS-rebinding
// defence). All transport concerns live here; nothing leaks into core or the contract.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { createAppRouter, type RpcDeps } from "./router.ts";

export interface ServerOptions {
  /** Port to listen on. 0 (default) lets the OS pick a free ephemeral port. */
  readonly port?: number;
  /** Directory of built UI assets to serve. When absent, a placeholder page is served. */
  readonly webRoot?: string;
}

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const MAX_PAYLOAD = 1 << 20; // 1 MiB: cap WS frames against a local memory DoS.

export async function startServer(deps: RpcDeps, options: ServerOptions = {}): Promise<RunningServer> {
  // The router's `reshape` handover needs to reconnect-broadcast (ADR-0012 §4), but the
  // ws handler that does the broadcasting is created below, after the router. Bridge the
  // cycle with a holder the router calls through; wired the moment the handler exists.
  let broadcastReconnect: () => void = () => {};
  const router = createAppRouter({ ...deps, broadcastReconnect: () => broadcastReconnect() });

  const httpServer = createServer((request, response) => {
    // DNS-rebinding defence: a non-loopback Host is refused outright.
    if (!isLoopbackHost(request.headers.host ?? null)) {
      response.writeHead(403).end("Forbidden.");
      return;
    }
    void serveHttp(request, response, options.webRoot);
  });

  // perMessageDeflate off: it's a known source of stalls/flakiness under load and buys
  // nothing for small local JSON frames (Bun.serve didn't deflate either).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  const handler = applyWSSHandler({
    wss,
    router,
    // Channel-inferred tier (ADR-0011 §5): every write over this socket is a browser
    // session, so the author is the fixed human tier. No CLI path reaches here.
    createContext: () => ({ author: { tier: "human" as const, reviewer: null } }),
    // Log the full error server-side; the router's errorFormatter masks what reaches the peer.
    onError: ({ error }) => console.error("cara RPC error:", error),
  });
  // Defer to a macrotask so the `reshape` mutation's own result is flushed to its caller
  // (the CLI present-client) BEFORE the reconnect notification tears that socket down —
  // otherwise the handover would race its own response and fail "connection not open".
  broadcastReconnect = () => void setTimeout(() => handler.broadcastReconnectNotification(), 0);

  httpServer.on("upgrade", (request, socket, head) => {
    // Host (DNS-rebinding) + Origin (CSRF) must both be loopback to upgrade. Upgrades
    // bypass the request handler, so the Host check is repeated here.
    if (!isLoopbackHost(request.headers.host ?? null) || !isLoopbackOrigin(request.headers.origin ?? null)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  await new Promise<void>((res) => httpServer.listen(options.port ?? 0, HOST, res));
  const address = httpServer.address();
  const port = typeof address === "object" && address !== null ? address.port : (options.port ?? 0);

  return {
    url: `http://${HOST}:${port}`,
    close: async () => {
      // Synchronous here (unlike the deferred reshape path): the server is shutting down,
      // so there is no in-flight mutation response on these sockets left to protect.
      handler.broadcastReconnectNotification();
      wss.close();
      await new Promise<void>((res) => {
        httpServer.close(() => res());
        httpServer.closeAllConnections();
      });
    },
  };
}

/** A loopback Host header (DNS-rebinding defence). A missing Host is rejected. */
function isLoopbackHost(host: string | null): boolean {
  if (host === null) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

/** A loopback Origin, or none at all (non-browser clients send no Origin). */
function isLoopbackOrigin(origin: string | null): boolean {
  if (origin === null || origin === "") return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

const PLACEHOLDER =
  "<!doctype html><meta charset=utf-8><title>cara</title>" +
  "<p>cara backend is running. The UI is not built yet.";

async function serveHttp(request: IncomingMessage, response: ServerResponse, webRoot?: string): Promise<void> {
  if (webRoot === undefined) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PLACEHOLDER);
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${HOST}`).pathname);
  } catch {
    response.writeHead(400).end("Bad request.");
    return;
  }

  const root = resolve(webRoot);
  const requested = resolve(root, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  // Reject path traversal: the resolved file must stay within the web root.
  const file = requested === root || requested.startsWith(root + sep) ? requested : null;

  if (file !== null && (await isFile(file))) {
    sendFile(response, file, contentType(file));
    return;
  }
  // SPA fallback: serve index.html for unknown in-app routes.
  const index = resolve(root, "index.html");
  if (await isFile(index)) {
    sendFile(response, index, "text/html; charset=utf-8");
    return;
  }
  response.writeHead(404).end("Not found.");
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function sendFile(response: ServerResponse, file: string, type: string): void {
  response.writeHead(200, { "content-type": type });
  createReadStream(file)
    .on("error", () => response.end())
    .pipe(response);
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}
