// The app state store: the shared foundation the diff surface (#12) builds on. Holds
// the current snapshot + UI focus, exposes subscribe/notify and the action set, and
// binds the transport lifecycle to a connection status. DOM-free — unit-tested under
// `node --test` against a fake transport/RpcClient.
//
// Chapters/Sections have no domain id; focus is an index path within the current
// snapshot (the grouping is regenerated on every `open`).

import type { AtomHash, Disposition, FileSide, ReviewSnapshot } from "./protocol.ts";
import type { RpcClient, Transport } from "./rpc.ts";

export type Connection = "connecting" | "open" | "closed" | "error";

export interface SectionPath {
  readonly chapter: number;
  readonly section: number;
}

export interface AppState {
  readonly connection: Connection;
  readonly snapshot: ReviewSnapshot | null;
  readonly error: string | null;
  readonly activeSection: SectionPath | null;
  readonly expandedChapters: ReadonlySet<number>;
}

const INITIAL: AppState = {
  connection: "connecting",
  snapshot: null,
  error: null,
  activeSection: null,
  expandedChapters: new Set(),
};

export class AppStore {
  private readonly rpc: RpcClient;
  private state: AppState = INITIAL;
  private readonly listeners = new Set<() => void>();

  constructor(rpc: RpcClient) {
    this.rpc = rpc;
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Map socket lifecycle to connection status; fetch the review once connected. */
  bindTransport(transport: Transport): void {
    transport.on("open", () => {
      this.patch({ connection: "open" });
      void this.open();
    });
    transport.on("close", () => this.patch({ connection: "closed" }));
    transport.on("error", () => this.patch({ connection: "error" }));
  }

  async open(): Promise<ReviewSnapshot> {
    try {
      const snapshot = await this.rpc.request("open", {});
      this.patch({ snapshot, error: null, ...initialFocus(snapshot) });
      return snapshot;
    } catch (error) {
      this.patch({ error: messageOf(error) });
      throw error;
    }
  }

  async mark(atomHash: AtomHash, disposition: Disposition): Promise<ReviewSnapshot> {
    const snapshot = await this.rpc.request("mark", {
      context: this.requireContext(),
      atomHash,
      disposition,
    });
    this.patch({ snapshot });
    return snapshot;
  }

  async unmark(atomHash: AtomHash): Promise<ReviewSnapshot> {
    const snapshot = await this.rpc.request("unmark", {
      context: this.requireContext(),
      atomHash,
    });
    this.patch({ snapshot });
    return snapshot;
  }

  async comment(atomHash: AtomHash, body: string): Promise<ReviewSnapshot> {
    const snapshot = await this.rpc.request("comment", {
      context: this.requireContext(),
      atomHash,
      body,
    });
    this.patch({ snapshot });
    return snapshot;
  }

  openInEditor(path: string, line: number): Promise<null> {
    return this.rpc.request("openInEditor", { path, line });
  }

  readFile(path: string, side: FileSide): Promise<{ readonly text: string | null }> {
    return this.rpc.request("readFile", { path, side });
  }

  setActiveSection(path: SectionPath): void {
    this.patch({ activeSection: path });
  }

  toggleChapter(index: number): void {
    const expandedChapters = new Set(this.state.expandedChapters);
    if (expandedChapters.has(index)) expandedChapters.delete(index);
    else expandedChapters.add(index);
    this.patch({ expandedChapters });
  }

  private requireContext(): ReviewSnapshot["context"] {
    const snapshot = this.state.snapshot;
    if (snapshot === null) throw new Error("No active review.");
    return snapshot.context;
  }

  private patch(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** On open, focus the first Section of the first Chapter that has any, and expand it. */
function initialFocus(snapshot: ReviewSnapshot): Pick<AppState, "activeSection" | "expandedChapters"> {
  const chapter = snapshot.review.chapters.findIndex((c) => c.sections.length > 0);
  if (chapter === -1) return { activeSection: null, expandedChapters: new Set() };
  return { activeSection: { chapter, section: 0 }, expandedChapters: new Set([chapter]) };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
