// Shared test fixtures (imported only by *.test.ts; never by the app bundle).
import assert from "node:assert/strict";
import type { Atom, AtomHash, Section } from "./protocol.ts";
import type { Transport, TransportEvent } from "./rpc.ts";

/** An in-memory Transport: capture sent frames, deliver responses, fire lifecycle events. */
export class FakeTransport implements Transport {
  readonly sent: string[] = [];
  private message: ((data: string) => void) | null = null;
  private readonly handlers: Record<TransportEvent, Array<() => void>> = { open: [], close: [], error: [] };

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
  onMessage(handler: (data: string) => void): void {
    this.message = handler;
  }
  on(event: TransportEvent, handler: () => void): void {
    this.handlers[event].push(handler);
  }
  deliver(data: string): void {
    this.message?.(data);
  }
  fire(event: TransportEvent): void {
    for (const handler of this.handlers[event]) handler();
  }
  lastRequest(): { id: string; method: string; params: Record<string, unknown> } {
    const raw = this.sent.at(-1);
    assert.ok(raw !== undefined, "expected a request to have been sent");
    return JSON.parse(raw);
  }
  lastId(): string {
    return this.lastRequest().id;
  }
}

export function atom(hash: string): Atom {
  return {
    status: "modified",
    path: "f.ts",
    previousPath: null,
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: "added", text: "x" }],
    hash: hash as AtomHash,
  };
}

export function section(title: string, hashes: readonly string[]): Section {
  return { title, summary: null, atoms: hashes.map(atom) };
}
