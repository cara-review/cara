// The app state store: the shared foundation the diff surface (#12) builds on. Holds
// the current snapshot + UI focus, exposes subscribe/notify and the action set, and
// maps the backend's socket lifecycle to a connection status.
// DOM-free — unit-tested under `bun test` against a fake Backend.
//
// Post-pivot (ADR-0011): grouping is pre-supplied by the CLI before the browser boots.
// The browser loads the review snapshot at boot via a one-shot query (no streaming).
// Chapters/Sections have no domain id; focus is an index path within the current
// snapshot (the grouping is fixed for the session by `present`).

import type { Backend, ConnectionStatus } from "./backend.ts";
import type { AtomHash, Disposition, FileSide, ReviewContext, ReviewSnapshot } from "./protocol.ts";

export type Connection = "connecting" | "open" | "reconnecting" | "closed";

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
  private readonly backend: Backend;
  private state: AppState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private context: ReviewContext | null = null;

  constructor(backend: Backend) {
    this.backend = backend;
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

  /** Connect the socket and load the review snapshot (one-shot query at boot). */
  connect(context: ReviewContext | null): void {
    this.context = context;
    this.backend.onConnection((status) => this.onConnection(status));
    if (context !== null) {
      void this.loadReview(context);
    }
  }

  private onConnection(status: ConnectionStatus): void {
    if (status === "open") {
      this.patch({ connection: "open" });
      // Re-load snapshot on reconnect only if we have no snapshot yet (first connect).
      if (this.state.snapshot === null && this.context !== null) {
        void this.loadReview(this.context);
      }
    } else {
      this.patch({ connection: "reconnecting" });
    }
  }

  private async loadReview(context: ReviewContext): Promise<void> {
    try {
      const snapshot = await this.backend.loadSnapshot(context);
      this.patch({ snapshot, error: null, ...initialFocus(snapshot) });
    } catch (error: unknown) {
      this.patch({ error: error instanceof Error ? error.message : "Failed to load review.", snapshot: null });
    }
  }

  async mark(atomHash: AtomHash, disposition: Disposition): Promise<ReviewSnapshot> {
    const snapshot = await this.backend.mark(this.requireContext(), atomHash, disposition);
    this.patch({ snapshot });
    return snapshot;
  }

  async unmark(atomHash: AtomHash): Promise<ReviewSnapshot> {
    const snapshot = await this.backend.unmark(this.requireContext(), atomHash);
    this.patch({ snapshot });
    return snapshot;
  }

  async comment(atomHash: AtomHash, body: string): Promise<ReviewSnapshot> {
    const snapshot = await this.backend.comment(this.requireContext(), atomHash, body);
    this.patch({ snapshot });
    return snapshot;
  }

  /** Signal "done reviewing" — the human synchroniser for `dispatch --wait`. */
  async markComplete(): Promise<void> {
    await this.backend.markComplete(this.requireContext());
  }

  openInEditor(path: string, line: number): Promise<void> {
    return this.backend.openInEditor(path, line);
  }

  readFile(path: string, side: FileSide): Promise<{ readonly text: string | null }> {
    return this.backend.readFile(path, side);
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

  private requireContext(): ReviewContext {
    const ctx = this.context;
    if (ctx === null) throw new Error("No active review.");
    return ctx;
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
