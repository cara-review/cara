// The app state store: the shared foundation the diff surface (#12) builds on. Holds
// the current snapshot + UI focus + live grouping progress, exposes subscribe/notify
// and the action set, and maps the backend's socket lifecycle to a connection status.
// DOM-free — unit-tested under `bun test` against a fake Backend.
//
// Chapters/Sections have no domain id; focus is an index path within the current
// snapshot (the grouping is regenerated on every open).

import type { Backend, ConnectionStatus } from "./backend.ts";
import type { AtomHash, ChatAnswer, DispatchReceipt, Disposition, FileSide, ReviewSnapshot } from "./protocol.ts";

export type Connection = "connecting" | "open" | "reconnecting" | "closed";

export interface SectionPath {
  readonly chapter: number;
  readonly section: number;
}

/** Live grouping progress while the agent organises the diff (before the snapshot lands). */
export interface GroupingProgress {
  readonly elapsedMs: number;
  /** Section titles revealed so far — the scrolling reveal of the resolved structure. */
  readonly sections: readonly string[];
}

export interface AppState {
  readonly connection: Connection;
  readonly snapshot: ReviewSnapshot | null;
  readonly error: string | null;
  readonly activeSection: SectionPath | null;
  readonly expandedChapters: ReadonlySet<number>;
  /** Non-null while grouping is in flight (socket open, no snapshot yet); null once it lands. */
  readonly grouping: GroupingProgress | null;
}

const INITIAL: AppState = {
  connection: "connecting",
  snapshot: null,
  error: null,
  activeSection: null,
  expandedChapters: new Set(),
  grouping: null,
};

export class AppStore {
  private readonly backend: Backend;
  private state: AppState = INITIAL;
  private readonly listeners = new Set<() => void>();

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

  /** Map socket lifecycle to a connection status and open the streaming review. */
  connect(): void {
    this.backend.onConnection((status) => this.onConnection(status));
    this.backend.openReview({
      onProgress: (elapsedMs) => this.patch({ grouping: { elapsedMs, sections: this.groupingSections() } }),
      onSection: (title) =>
        this.patch({ grouping: { elapsedMs: this.groupingElapsed(), sections: [...this.groupingSections(), title] } }),
      onSnapshot: (snapshot) => this.patch({ snapshot, grouping: null, error: null, ...initialFocus(snapshot) }),
      onError: (message) => this.patch({ error: message, grouping: null }),
    });
  }

  private onConnection(status: ConnectionStatus): void {
    if (status === "open") {
      // Socket up; if no review yet, begin showing grouping progress.
      this.patch({ connection: "open", grouping: this.state.snapshot === null ? this.beginGrouping() : null });
    } else {
      this.patch({ connection: "reconnecting" });
    }
  }

  private beginGrouping(): GroupingProgress {
    return this.state.grouping ?? { elapsedMs: 0, sections: [] };
  }

  private groupingElapsed(): number {
    return this.state.grouping?.elapsedMs ?? 0;
  }

  private groupingSections(): readonly string[] {
    return this.state.grouping?.sections ?? [];
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

  /** `Go` (ADR-0007): push the accumulated comments out the sink; returns the receipt. */
  async dispatch(): Promise<DispatchReceipt> {
    return this.backend.dispatch(this.requireContext());
  }

  /** Chapter Q&A (ADR-0009): ask the agent about a Chapter; returns its untrusted answer. */
  async ask(chapterIndex: number, question: string): Promise<ChatAnswer> {
    return this.backend.ask(this.requireContext(), chapterIndex, question);
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
