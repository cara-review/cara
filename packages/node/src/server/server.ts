// The Bun.serve server (ADR-0003, ADR-0008): the driving adapter that carries the
// tRPC router over one WebSocket and serves the built UI over HTTP. Binds 127.0.0.1
// only — local-first, no external surface (ADR-0001). A loopback bind is still
// reachable cross-origin from any page in the user's browser, so both HTTP and the WS
// upgrade enforce a loopback Origin + Host allowlist (CSRF / DNS-rebinding defence).
// All transport concerns live here; nothing leaks into core or the router contract.

import { extname, resolve, sep } from "node:path";
import { createBunWSHandler, type BunWSClientCtx } from "trpc-bun-adapter";
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
  const router = createAppRouter(deps);
  const websocket = createBunWSHandler({
    router,
    // Log the full error server-side; the router's errorFormatter masks what reaches the peer.
    onError: ({ error }: { error: unknown }) => console.error("clear-diff RPC error:", error),
  });

  const server = Bun.serve({
    hostname: HOST,
    port: options.port ?? 0,
    fetch(request, srv) {
      // DNS-rebinding defence: a non-loopback Host is refused outright (HTTP and WS alike).
      if (!isLoopbackHost(request.headers.get("host"))) return new Response("Forbidden.", { status: 403 });

      if ((request.headers.get("upgrade") ?? "").toLowerCase() === "websocket") {
        // CSRF defence: only a loopback (or absent, for non-browser clients) Origin may upgrade.
        if (!isLoopbackOrigin(request.headers.get("origin"))) {
          return new Response("Forbidden origin.", { status: 403 });
        }
        const data = { req: request } as BunWSClientCtx<typeof router>;
        if (srv.upgrade(request, { data })) return undefined;
        return new Response("WebSocket upgrade failed.", { status: 400 });
      }

      return serveHttp(request, options.webRoot);
    },
    websocket: { ...websocket, maxPayloadLength: MAX_PAYLOAD },
  });

  return {
    url: `http://${HOST}:${server.port}`,
    close: async () => {
      await server.stop(true);
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
  "<!doctype html><meta charset=utf-8><title>clear-diff</title>" +
  "<p>clear-diff backend is running. The UI is not built yet.";

async function serveHttp(request: Request, webRoot?: string): Promise<Response> {
  if (webRoot === undefined) {
    return new Response(PLACEHOLDER, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Bad request.", { status: 400 });
  }

  const root = resolve(webRoot);
  const requested = resolve(root, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  // Reject path traversal: the resolved file must stay within the web root.
  const file = requested === root || requested.startsWith(root + sep) ? requested : null;

  if (file !== null) {
    const asset = Bun.file(file);
    if (await asset.exists()) {
      return new Response(asset, { headers: { "content-type": contentType(file) } });
    }
  }
  // SPA fallback: serve index.html for unknown in-app routes.
  const index = Bun.file(resolve(root, "index.html"));
  if (await index.exists()) {
    return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new Response("Not found.", { status: 404 });
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
