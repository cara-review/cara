// The single WebSocket RPC channel to the backend (ADR-0003). The UI reaches the
// backend only through here. `Transport` abstracts the socket so the RpcClient and
// AppStore unit-test against a fake under `node --test` (no real WebSocket).

import type { ClientRequest, Method, RequestParams, ResultMap, ServerResponse } from "./protocol.ts";

export type TransportEvent = "open" | "close" | "error";

/** The byte-level channel under the RPC. Implemented by WebSocket; faked in tests. */
export interface Transport {
  send(data: string): void;
  close(): void;
  onMessage(handler: (data: string) => void): void;
  on(event: TransportEvent, handler: () => void): void;
}

/** A real browser WebSocket as a Transport. The only place `WebSocket` is touched. */
export class WebSocketTransport implements Transport {
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }

  onMessage(handler: (data: string) => void): void {
    this.socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") handler(event.data);
    });
  }

  on(event: TransportEvent, handler: () => void): void {
    this.socket.addEventListener(event, () => handler());
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
