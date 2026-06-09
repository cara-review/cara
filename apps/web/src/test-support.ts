// Shared test fixtures (imported only by *.test.ts; never by the app bundle).
import type { Backend, ConnectionStatus } from "./backend.ts";
import type { Atom, AtomHash, FileSide, ReviewContext, ReviewSnapshot, Section } from "./protocol.ts";

/**
 * An in-memory Backend: record the actions issued, and drive the connection lifecycle
 * from the test. `reply` is the snapshot every mutation or loadSnapshot resolves with;
 * stage it in the test before the call.
 */
export class FakeBackend implements Backend {
  readonly calls: string[] = [];
  /** Snapshot the next loadSnapshot or mutation resolves with — the test stages it before acting. */
  reply: ReviewSnapshot | null = null;
  fileReply: { readonly text: string | null } = { text: "body" };

  private connectionHandler: ((status: ConnectionStatus) => void) | null = null;

  onConnection(handler: (status: ConnectionStatus) => void): void {
    this.connectionHandler = handler;
  }

  // --- test drivers ---------------------------------------------------------
  fireConnection(status: ConnectionStatus): void {
    this.connectionHandler?.(status);
  }

  // --- Backend mutations / queries -----------------------------------------
  loadSnapshot(context: ReviewContext): Promise<ReviewSnapshot> {
    this.calls.push(`loadSnapshot:${context}`);
    return Promise.resolve(this.requireReply());
  }
  mark(context: string, atomHash: string, disposition: string): Promise<ReviewSnapshot> {
    this.calls.push(`mark:${context}:${atomHash}:${disposition}`);
    return Promise.resolve(this.requireReply());
  }
  unmark(context: string, atomHash: string): Promise<ReviewSnapshot> {
    this.calls.push(`unmark:${context}:${atomHash}`);
    return Promise.resolve(this.requireReply());
  }
  comment(context: string, atomHash: string, body: string): Promise<ReviewSnapshot> {
    this.calls.push(`comment:${context}:${atomHash}:${body}`);
    return Promise.resolve(this.requireReply());
  }
  markComplete(context: string): Promise<void> {
    this.calls.push(`markComplete:${context}`);
    return Promise.resolve();
  }
  openInEditor(path: string, line: number): Promise<void> {
    this.calls.push(`editor:${path}:${line}`);
    return Promise.resolve();
  }
  readFile(path: string, side: FileSide): Promise<{ readonly text: string | null }> {
    this.calls.push(`readFile:${path}:${side}`);
    return Promise.resolve(this.fileReply);
  }

  private requireReply(): ReviewSnapshot {
    if (this.reply === null) throw new Error("FakeBackend.reply not staged for this call");
    return this.reply;
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
