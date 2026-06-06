// The single WebSocket RPC channel to the backend (ADR-0003). The UI reaches the
// backend only through here. `Transport` abstracts the socket so the RpcClient and
// AppStore unit-test against a fake under `node --test` (no real WebSocket).

import type { ClientRequest, Method, RequestParams, ResultMap, ServerResponse } from "./protocol.ts";

// `reconnecting` fires while the transport is between sockets and will retry;
// `close` is terminal — fired only once retries are exhausted. A socket-level
// `error` always precedes a `close`, so reconnect is driven off `close` alone.
export type TransportEvent = "open" | "close" | "reconnecting";

/** The byte-level channel under the RPC. Implemented by WebSocket; faked in tests. */
export interface Transport {
  send(data: string): void;
  close(): void;
  onMessage(handler: (data: string) => void): void;
  on(event: TransportEvent, handler: () => void): void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 4000;
const RECONNECT_MAX_ATTEMPTS = 12;

/**
 * A real browser WebSocket as a Transport, with auto-reconnect. The only place
 * `WebSocket` is touched. A dropped backend (the local server restarting) is
 * retried with capped exponential backoff: each lost socket fires `reconnecting`
 * and a fresh socket is wired up; `close` fires only once the attempts run out.
 */
export class WebSocketTransport implements Transport {
  private readonly url: string;
  private socket: WebSocket;
  private message: ((data: string) => void) | null = null;
  private readonly handlers: Record<TransportEvent, Array<() => void>> = {
    open: [],
    close: [],
    reconnecting: [],
  };
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(url: string) {
    this.url = url;
    this.socket = this.connect();
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.socket.close();
  }

  onMessage(handler: (data: string) => void): void {
    this.message = handler;
  }

  on(event: TransportEvent, handler: () => void): void {
    this.handlers[event].push(handler);
  }

  private connect(): WebSocket {
    const socket = new WebSocket(this.url);
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") this.message?.(event.data);
    });
    socket.addEventListener("open", () => {
      this.attempts = 0;
      this.emit("open");
    });
    // A socket 'error' is always followed by 'close'; reconnect is driven there.
    socket.addEventListener("error", () => {});
    socket.addEventListener("close", () => this.onSocketClose());
    return socket;
  }

  private onSocketClose(): void {
    if (this.stopped) return;
    if (this.attempts >= RECONNECT_MAX_ATTEMPTS) {
      this.emit("close");
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempts, RECONNECT_MAX_MS);
    this.attempts += 1;
    this.emit("reconnecting");
    this.retryTimer = setTimeout(() => {
      this.socket = this.connect();
    }, delay);
  }

  private emit(event: TransportEvent): void {
    for (const handler of this.handlers[event]) handler();
  }
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

/** Correlates each request to its response by `id`. One outstanding map, fail-closed. */
export class RpcClient {
  private readonly transport: Transport;
  private readonly pending = new Map<string, Pending>();
  private nextId = 0;

  constructor(transport: Transport) {
    this.transport = transport;
    transport.onMessage((data) => this.receive(data));
  }

  request<M extends Method>(method: M, params: RequestParams[M]): Promise<ResultMap[M]> {
    const id = String(++this.nextId);
    const message: ClientRequest = { id, method, params } as ClientRequest;
    return new Promise<ResultMap[M]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.transport.send(JSON.stringify(message));
    });
  }

  private receive(data: string): void {
    const response = parseResponse(data);
    if (response === null) return;
    const pending = this.pending.get(response.id);
    if (pending === undefined) return; // unknown or already-settled id
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error));
  }
}

/** Narrow an inbound frame to a ServerResponse, or null if it is not one. */
function parseResponse(raw: string): ServerResponse | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const frame = value as Record<string, unknown>;
  if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") return null;
  if (frame.ok === false && typeof frame.error !== "string") return null; // error frame needs a message
  return value as ServerResponse;
}
