// HTTP/WS server (ADR-0003), the driving adapter over ReviewService. HTTP serves
// the built UI (static, when present) or a placeholder; the WebSocket carries the
// RPC contract (protocol.ts). Binds 127.0.0.1 only — local-first, no external
// surface (ADR-0001). A loopback bind is still reachable cross-origin from any
// page in the user's browser, so the WS handshake and HTTP both enforce a
// loopback Origin + Host allowlist (CSRF / DNS-rebinding defence). All transport
// concerns live here; nothing leaks into core.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse as HttpResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { RpcDeps } from "./dispatch.ts";
import { handleRequest } from "./dispatch.ts";

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
  const http = createServer((request, response) => {
    void serveHttp(request, response, options.webRoot);
  });
  const sockets = new WebSocketServer({
    server: http,
    maxPayload: MAX_PAYLOAD,
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) =>
      isLoopbackOrigin(origin) && isLoopbackHost(req.headers.host),
  });
  sockets.on("connection", (socket) => {
    socket.on("message", (data) => {
      void onMessage(deps, socket, data);
    });
  });

  await listen(http, options.port ?? 0);
  const address = http.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://${HOST}:${port}`,
    close: () => close(http, sockets),
  };
}

async function onMessage(deps: RpcDeps, socket: WebSocket, data: RawData): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(decode(data));
  } catch {
    socket.send(JSON.stringify({ id: "", ok: false, error: "Invalid JSON." }));
    return;
  }
  socket.send(JSON.stringify(await handleRequest(deps, raw)));
}

function decode(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

/** A loopback Host header (DNS-rebinding defence). A missing Host is rejected. */
function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

/** A loopback Origin, or none at all (non-browser clients send no Origin). */
function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin === "") return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

const PLACEHOLDER =
  "<!doctype html><meta charset=utf-8><title>clear-diff</title>" +
  "<p>clear-diff backend is running. The UI is not built yet.";

async function serveHttp(request: IncomingMessage, response: HttpResponse, webRoot?: string): Promise<void> {
  if (!isLoopbackHost(request.headers.host)) {
    response.writeHead(403);
    response.end("Forbidden.");
    return;
  }
  if (webRoot === undefined) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PLACEHOLDER);
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
  } catch {
    response.writeHead(400);
    response.end("Bad request.");
    return;
  }

  const root = resolve(webRoot);
  const requested = resolve(root, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  // Reject path traversal: the resolved file must stay within the web root.
  const file = requested === root || requested.startsWith(root + sep) ? requested : null;

  if (file !== null) {
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": contentType(file) });
      response.end(body);
      return;
    } catch {
      // Fall through to the SPA index fallback below.
    }
  }
  try {
    const index = await readFile(resolve(root, "index.html"));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(index);
  } catch {
    response.writeHead(404);
    response.end("Not found.");
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.removeListener("error", reject);
      done();
    });
  });
}

function close(server: Server, sockets: WebSocketServer): Promise<void> {
  return new Promise((done, reject) => {
    for (const client of sockets.clients) client.terminate();
    sockets.close(() => {
      server.close((error) => (error ? reject(error) : done()));
    });
  });
}
