// The app state store: the foundation the diff surface builds on. Holds the current
// snapshot + UI focus, exposes subscribe/notify and the action set, and maps the
// backend's socket lifecycle to a connection status.
// DOM-free — unit-tested under `bun test` against a fake Backend.
//
// Grouping is fixed for the session by the CLI `present` verb before the browser boots;
// the browser loads the review snapshot at boot via a one-shot query (no streaming).
// On every reconnect the snapshot is re-queried — a reshape broadcast arrives as a
// reconnect-broadcast (ADR-0012 §4); the browser picks up the new grouping on reconnect.
// Chapters/Sections have no domain id — focus is an index path within the snapshot.

import type { Backend, ConnectionStatus } from "./backend.ts";
import type { AtomHash, CommentLinePointer, Disposition, FileSide, ReviewContext, ReviewSnapshot } from "./protocol.ts";

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
  /** Monotonic counter: incremented on each loadReview call; stale responses are dropped. */
  private loadGeneration = 0;

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
      // Every reconnect reloads the snapshot (ADR-0012 §4): a reshape broadcast arrives
      // as a reconnect-broadcast and the browser picks up the new grouping on re-query.
      if (this.context !== null) {
        void this.loadReview(this.context);
      }
    } else {
      this.patch({ connection: "reconnecting" });
    }
  }

  private async loadReview(context: ReviewContext): Promise<void> {
    const gen = ++this.loadGeneration;
    try {
      const snapshot = await this.backend.loadSnapshot(context);
      // Drop stale responses: a newer reconnect fired while this request was in flight.
      if (gen !== this.loadGeneration) return;
      const focus =
        this.state.snapshot !== null
          ? preserveFocus(snapshot, this.state.activeSection)
          : initialFocus(snapshot);
      this.patch({ snapshot, error: null, ...focus });
    } catch (error: unknown) {
      if (gen !== this.loadGeneration) return;
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

  /**
   * Post a comment on an atom. The optional `pointer` pins it to a specific within-hunk
   * line by content + side (ADR-0012 §2). Absent → block-level comment.
   */
  async comment(atomHash: AtomHash, body: string, pointer?: CommentLinePointer): Promise<ReviewSnapshot> {
    const snapshot = await this.backend.comment(this.requireContext(), atomHash, body, pointer);
    this.patch({ snapshot });
    return snapshot;
  }

  /**
   * Human reshape request (ADR-0012 §3): records a note for the agent to regroup.
   * The snapshot carries `pendingReshape` until the agent re-presents (which clears it).
   */
  async requestReshape(body: string): Promise<void> {
    const snapshot = await this.backend.requestReshape(this.requireContext(), body);
    this.patch({ snapshot });
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

/**
 * On reconnect, keep the existing focus when the path still exists in the new grouping;
 * otherwise fall back to `initialFocus`. Prevents the scroll-reset that would occur if
 * the agent re-presents a structurally identical or similar grouping.
 */
function preserveFocus(
  snapshot: ReviewSnapshot,
  active: SectionPath | null,
): Pick<AppState, "activeSection" | "expandedChapters"> {
  if (active !== null) {
    const ch = snapshot.review.chapters[active.chapter];
    if (ch !== undefined && ch.sections[active.section] !== undefined) {
      return { activeSection: active, expandedChapters: new Set([active.chapter]) };
    }
  }
  return initialFocus(snapshot);
}
