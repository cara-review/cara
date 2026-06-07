// The diff surface (ADR-0006): renders the focused Section's evidence into the shell's stable
// `[data-diff-surface]` mount as a vertical stack of per-file Monaco diff editors. Per file the
// modified buffer is the real head and the original is head with only THIS Section's atoms
// reverted (synthetic-buffers.ts), so only those atoms read as changes and Monaco folds the rest
// via hideUnchangedRegions. Marks stay canonical (read back from the snapshot) and per-atom on the
// wire (ADR-0004); the agent never authors the diff — every rendered line is git-verbatim head or
// base text. DOM-bound; the structural and marking logic it leans on (diff-model, controller) is
// pure and tested.

import "./monaco-env.ts";
import "./diff-surface.css";
import * as monaco from "monaco-editor";
import { el, fill } from "../dom.ts";
import { marksMap } from "../selectors.ts";
import { sectionAt } from "../navigation.ts";
import { groupByFile, type FileGroup } from "./diff-model.ts";
import { syntheticBuffers } from "./synthetic-buffers.ts";
import { createCommentThreads, type CommentThreads } from "./comments.ts";
import { markSectionDone, skipSection, toggleFile } from "./controller.ts";
import type { AppState, AppStore, SectionPath } from "../store.ts";

/** Toolbar-controlled render flags: #16 (inline ↔ side-by-side) and #28 (show all diffs). */
export interface SurfaceOptions {
  /** Side-by-side when true, inline when false (#16). */
  readonly renderSideBySide: boolean;
  /** Diff the whole file against its real base, not the per-Section synthetic base (#28). */
  readonly showAllDiffs: boolean;
}

const DEFAULTS: SurfaceOptions = { renderSideBySide: false, showAllDiffs: false };
const STORAGE_KEY = "clear-diff:surface-options";

export interface DiffSurface {
  render(state: AppState): void;
  /** Flip side-by-side (#16). The keyboard seam; the matching button lives in the toolbar. */
  toggleSideBySide(): void;
}

/** Restore persisted toggles, falling back to defaults for missing/corrupt storage. */
function loadOptions(): SurfaceOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const rec = parsed as Record<string, unknown>;
    return {
      renderSideBySide: typeof rec["renderSideBySide"] === "boolean" ? rec["renderSideBySide"] : DEFAULTS.renderSideBySide,
      showAllDiffs: typeof rec["showAllDiffs"] === "boolean" ? rec["showAllDiffs"] : DEFAULTS.showAllDiffs,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveOptions(options: SurfaceOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Storage unavailable (private mode / quota) — toggles still work for the session.
  }
}

interface FileCard {
  readonly group: FileGroup;
  readonly editor: monaco.editor.IStandaloneDiffEditor;
  readonly original: monaco.editor.ITextModel;
  readonly modified: monaco.editor.ITextModel;
  readonly container: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly card: HTMLElement;
  readonly threads: CommentThreads;
}

// Synthetic originals can be invalid mid-edit; suppress IntelliSense squiggles in the read-only view.
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
});
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
});

/** Create the surface bound to a mount + store. Editors are recycled on Section/option change. */
export function createDiffSurface(mount: HTMLElement, store: AppStore): DiffSurface {
  let options = loadOptions();
  let renderKey: string | null = null;
  let cards: FileCard[] = [];
  let generation = 0;
  let rafId = 0;

  const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(darkMedia.matches);
  darkMedia.addEventListener("change", (event) => applyTheme(event.matches));

  // Manual layout (automaticLayout is off): re-fit when the container's width changes,
  // e.g. the shell's pane resize/collapse, which dispatches a window `resize`.
  window.addEventListener("resize", scheduleFit);

  function disposeCards(): void {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    for (const card of cards) {
      card.threads.dispose();
      card.editor.dispose();
      card.original.dispose();
      card.modified.dispose();
    }
    cards = [];
  }

  function clear(): void {
    disposeCards();
    generation += 1;
    renderKey = null;
    mount.replaceChildren();
  }

  /** Recompute height from each editor's (folded) content and resize so the page scrolls as one. */
  function fit(): void {
    for (const card of cards) {
      const height = Math.max(
        card.editor.getOriginalEditor().getContentHeight(),
        card.editor.getModifiedEditor().getContentHeight(),
      );
      card.container.style.height = `${height}px`;
      // Explicit dimensions: a no-arg layout() mis-measures the auto-sized container to ~0px.
      card.editor.layout({ width: card.container.clientWidth, height });
    }
  }

  function scheduleFit(): void {
    if (rafId !== 0) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      fit();
    });
  }

  function makeCard(group: FileGroup, head: string, original: string): FileCard {
    const language = languageFor(group.path);
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(head, language);

    const path = el("button", {
      class: "file__path",
      text: pathLabel(group),
      title: "Open in editor",
      onClick: () => void store.openInEditor(group.path, group.atoms[0]?.newStart ?? 1),
    });
    const toggle = el("button", { class: "file__done", attrs: { "aria-pressed": "false" } });
    toggle.addEventListener("click", () => void toggleFile(store, group.atoms));
    const header = el("div", { class: "file__header" }, [
      path,
      el("span", { class: `file__status file__status--${group.status}`, text: group.status }),
      toggle,
    ]);
    const container = el("div", { class: "file__editor" });
    const card = el("section", { class: "file" }, [header, container]);

    const editor = monaco.editor.createDiffEditor(container, editorOptions(options));
    editor.setModel({ original: originalModel, modified: modifiedModel });
    editor.getOriginalEditor().onDidContentSizeChange(scheduleFit);
    editor.getModifiedEditor().onDidContentSizeChange(scheduleFit);
    editor.onDidUpdateDiff(scheduleFit);

    const threads = createCommentThreads(editor.getModifiedEditor(), group.atoms, store);

    return { group, editor, original: originalModel, modified: modifiedModel, container, toggle, card, threads };
  }

  /** Fetch every file's buffers, then (if still current) build the stack. Async; race-guarded. */
  async function rebuild(snapshot: AppState["snapshot"], section: ReturnType<typeof sectionAt>): Promise<void> {
    if (snapshot === null || section === null) return;
    const myGeneration = ++generation;
    const groups = groupByFile(section);

    const built = await Promise.all(
      groups.map(async (group) => {
        const head = (await store.readFile(group.path, "head")).text ?? "";
        const original = options.showAllDiffs
          ? (await store.readFile(group.path, "base")).text ?? ""
          : syntheticBuffers(head, group.atoms).original;
        return { group, head, original };
      }),
    );
    if (myGeneration !== generation) return; // a newer rebuild superseded us

    disposeCards();
    cards = built.map(({ group, head, original }) => makeCard(group, head, original));
    fill(mount, toolbar(), ...cards.map((card) => card.card), actionBar(store));
    // A mark or comment may have landed while files were fetching: paint the latest, not the stale.
    const current = store.getState().snapshot ?? snapshot;
    updateMarks(current);
    updateComments(current);
    scheduleFit();
  }

  function updateMarks(snapshot: NonNullable<AppState["snapshot"]>): void {
    const marks = marksMap(snapshot);
    for (const card of cards) {
      const done = card.group.atoms.every((atom) => marks.get(atom.hash) === "done");
      card.toggle.textContent = done ? "✓ Reviewed" : "Mark reviewed";
      card.toggle.classList.toggle("file__done--on", done);
      card.toggle.setAttribute("aria-pressed", String(done));
      card.card.classList.toggle("file--reviewed", done);
    }
  }

  function updateComments(snapshot: NonNullable<AppState["snapshot"]>): void {
    for (const card of cards) card.threads.update(snapshot.comments);
  }

  function render(state: AppState): void {
    if (state.snapshot === null || state.activeSection === null) {
      clear();
      return;
    }
    const section = sectionAt(state.snapshot, state.activeSection);
    if (section === null) {
      clear();
      return;
    }
    if (section.atoms.length === 0) {
      disposeCards();
      generation += 1;
      renderKey = "empty";
      fill(mount, el("p", { class: "surface__empty", text: "No changes in this Section." }));
      return;
    }

    const key = renderKeyFor(state.activeSection, section, options);
    if (key !== renderKey) {
      renderKey = key;
      void rebuild(state.snapshot, section);
    } else {
      updateMarks(state.snapshot);
      updateComments(state.snapshot);
    }
  }

  function setOption(patch: Partial<SurfaceOptions>): void {
    options = { ...options, ...patch };
    saveOptions(options);
    render(store.getState());
  }

  function toggleSideBySide(): void {
    setOption({ renderSideBySide: !options.renderSideBySide });
  }

  /** The diff-surface control bar: side-by-side/inline (#16) + show-all-diffs (#28). */
  function toolbar(): HTMLElement {
    return el("div", { class: "diff-toolbar" }, [
      toggleButton("Side by side", "Toggle side-by-side (v)", options.renderSideBySide, toggleSideBySide),
      toggleButton("All file changes", "Show every change in the file, not just this Section", options.showAllDiffs, () =>
        setOption({ showAllDiffs: !options.showAllDiffs }),
      ),
    ]);
  }

  return { render, toggleSideBySide };
}

function toggleButton(label: string, title: string, on: boolean, onClick: () => void): HTMLButtonElement {
  const button = el("button", {
    class: "diff-toolbar__toggle",
    text: label,
    title,
    attrs: { "aria-pressed": String(on) },
    onClick,
  });
  button.classList.toggle("diff-toolbar__toggle--on", on);
  return button;
}

/** Identity of a rendered stack: the Section's atoms + the active render options. */
function renderKeyFor(path: SectionPath, section: NonNullable<ReturnType<typeof sectionAt>>, options: SurfaceOptions): string {
  const atoms = section.atoms.map((atom) => atom.hash).join(",");
  return `${path.chapter}:${path.section}|sbs=${options.renderSideBySide}|all=${options.showAllDiffs}|${atoms}`;
}

function actionBar(store: AppStore): HTMLElement {
  return el("div", { class: "actionbar" }, [
    el("button", { class: "action action--skip", text: "Skip", onClick: () => void skipSection(store) }),
    el("button", { class: "action action--done", text: "✓ Done & Next", onClick: () => void markSectionDone(store) }),
  ]);
}

function pathLabel(group: FileGroup): string {
  return group.status === "renamed" && group.previousPath !== null
    ? `${group.previousPath} → ${group.path}`
    : group.path;
}

function editorOptions(options: SurfaceOptions): monaco.editor.IStandaloneDiffEditorConstructionOptions {
  const fontFamily = readToken("--font-mono");
  return {
    renderSideBySide: options.renderSideBySide,
    // Honour the explicit #16 toggle; don't let Monaco silently collapse to inline in a narrow pane.
    useInlineViewWhenSpaceIsLimited: false,
    readOnly: true,
    originalEditable: false,
    automaticLayout: false,
    hideUnchangedRegions: { enabled: true },
    renderOverviewRuler: false,
    scrollBeyondLastLine: false,
    // No inner vertical scrollbar: the editor is auto-sized so the page scrolls past files as one.
    scrollbar: { vertical: "hidden", alwaysConsumeMouseWheel: false, handleMouseWheel: false },
    minimap: { enabled: false },
    glyphMargin: false,
    folding: false,
    contextmenu: false,
    fontSize: 13,
    lineNumbersMinChars: 3,
    ...(fontFamily !== "" ? { fontFamily } : {}),
  };
}

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  md: "markdown",
};

function languageFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return LANGUAGES[ext] ?? "plaintext";
}

/** Define a theme whose background tracks the shell's light/dark tokens, and apply it. */
function applyTheme(dark: boolean): void {
  const background = readToken("--bg-main") || (dark ? "#0a0a0a" : "#ffffff");
  monaco.editor.defineTheme("clear-diff", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: { "editor.background": background, "editorGutter.background": background },
  });
  monaco.editor.setTheme("clear-diff");
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
