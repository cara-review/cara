// Shared test fixtures (imported only by *.test.ts; never by the app bundle).
import type { Backend, ConnectionStatus, OpenHandlers } from "./backend.ts";
import type { Atom, AtomHash, ChatAnswer, DispatchReceipt, ReviewSnapshot, Section } from "./protocol.ts";

/**
 * An in-memory Backend: record the actions issued, and drive the open subscription +
 * connection lifecycle from the test. Mutations resolve with `reply` (the snapshot the
 * test stages); dispatch/ask/readFile resolve with their own staged replies.
 */
export class FakeBackend implements Backend {
  readonly calls: string[] = [];
  /** Snapshot the next mutation resolves with — the test stages it before acting. */
  reply: ReviewSnapshot | null = null;
  dispatchReply: DispatchReceipt = { count: 0, location: "sink://ctx" };
  askReply: ChatAnswer = { answer: "ok" };
  fileReply: { readonly text: string | null } = { text: "body" };

  private connectionHandler: ((status: ConnectionStatus) => void) | null = null;
  private handlers: OpenHandlers | null = null;

  onConnection(handler: (status: ConnectionStatus) => void): void {
    this.connectionHandler = handler;
  }
  openReview(handlers: OpenHandlers): void {
    this.handlers = handlers;
  }

  // --- test drivers ---------------------------------------------------------
  fireConnection(status: ConnectionStatus): void {
    this.connectionHandler?.(status);
  }
  emitProgress(elapsedMs: number): void {
    this.handlers?.onProgress(elapsedMs);
  }
  emitSection(title: string): void {
    this.handlers?.onSection(title);
  }
  deliver(snapshot: ReviewSnapshot): void {
    this.handlers?.onSnapshot(snapshot);
  }
  failOpen(message: string): void {
    this.handlers?.onError(message);
  }

  // --- Backend mutations / queries -----------------------------------------
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
  dispatch(context: string): Promise<DispatchReceipt> {
    this.calls.push(`dispatch:${context}`);
    return Promise.resolve(this.dispatchReply);
  }
  ask(context: string, chapterIndex: number, question: string): Promise<ChatAnswer> {
    this.calls.push(`ask:${context}:${chapterIndex}:${question}`);
    return Promise.resolve(this.askReply);
  }
  openInEditor(path: string, line: number): Promise<void> {
    this.calls.push(`editor:${path}:${line}`);
    return Promise.resolve();
  }
  readFile(path: string, side: string): Promise<{ readonly text: string | null }> {
    this.calls.push(`readFile:${path}:${side}`);
    return Promise.resolve(this.fileReply);
  }

  private requireReply(): ReviewSnapshot {
    if (this.reply === null) throw new Error("FakeBackend.reply not staged for this mutation");
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
