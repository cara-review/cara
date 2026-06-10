// Inline comment threads on the diff surface (ADR-0006). Each atom in a file card gets
// one or more Monaco *view zones*: the composer always anchors at the atom's head line;
// line-anchored comments (ADR-0012 §2) get additional zones at their resolved line.
// View zones are a Monaco/adapter concern — the domain never names them.
//
// Comments anchor to atoms by hash (ADR-0002), never to raw line numbers. Bodies are
// user text rendered via textContent (the `el` factory) — escaped by construction.
// Answers are agent-supplied (untrusted overlay, ADR-0004): rendered via renderMarkdown
// (markdown-it + DOMPurify; see markdown.ts) and injected as innerHTML — two independent
// guards there provide defence-in-depth against injection.
// Reshape bodies are human-authored — plain text, never markup; escape on render.
//
// The composer shows a line picker (a <select> over the atom's added lines) so the human
// can optionally pin a comment to a specific within-hunk line. The picker is an explicit
// affordance ("pin to line") — not a passive mouse-click, keeping normal Monaco cursor
// interaction uninterrupted.

import * as monaco from "monaco-editor";
import { el } from "../dom.ts";
import { renderMarkdown } from "./markdown.ts";
import type { Atom, Comment, CommentLinePointer } from "../protocol.ts";
import type { AppStore } from "../store.ts";

export interface CommentThreads {
  /** Repaint the zones from the latest comments. A no-op when the set is unchanged. */
  update(comments: readonly Comment[]): void;
  dispose(): void;
}

interface Zone {
  readonly view: monaco.editor.IViewZone;
  readonly id: string;
  readonly node: HTMLElement;
  readonly observer: ResizeObserver;
}

/** Anchor line + comments for one zone; `isComposer` marks the headLine zone. */
interface ZoneGroup {
  readonly line: number;
  readonly comments: readonly Comment[];
  readonly isComposer: boolean;
}

/** Bind comment zones to a file card's modified (head) editor for its atoms. */
export function createCommentThreads(
  editor: monaco.editor.ICodeEditor,
  atoms: readonly Atom[],
  store: AppStore,
): CommentThreads {
  const zones: Zone[] = [];
  let signature: string | null = null;

  function clear(): void {
    editor.changeViewZones((accessor) => {
      for (const zone of zones) {
        zone.observer.disconnect();
        accessor.removeZone(zone.id);
      }
    });
    zones.length = 0;
  }

  function update(comments: readonly Comment[]): void {
    const next = signatureOf(atoms, comments);
    if (next === signature) return; // nothing relevant changed — keep focus
    signature = next;
    clear();
    editor.changeViewZones((accessor) => {
      for (const atom of atoms) {
        for (const group of buildZoneGroups(atom, comments)) {
          const node = zoneNode(atom, group, store);
          const view: monaco.editor.IViewZone = { afterLineNumber: group.line, domNode: node, heightInPx: 0 };
          const id = accessor.addZone(view);
          // Inline the relayout so the ResizeObserver closure only captures `view`, `node`,
          // and `id` — all of which are initialised before the observer is created.
          const observer = new ResizeObserver(() => {
            view.heightInPx = node.scrollHeight;
            editor.changeViewZones((acc) => acc.layoutZone(id));
          });
          const zone: Zone = { view, id, node, observer };
          observer.observe(node);
          zones.push(zone);
        }
      }
    });
  }

  return { update, dispose: clear };
}

/** The atom's last head line; for a pure deletion, the line it sits after. */
function headLine(atom: Atom): number {
  return atom.newLines > 0 ? atom.newStart + atom.newLines - 1 : Math.max(atom.newStart, 0);
}

/**
 * Build one ZoneGroup per distinct anchor line for this atom.
 * Block-level comments (line=null) and the composer share the headLine zone.
 * Line-anchored comments get their own zones at their resolved line.
 */
function buildZoneGroups(atom: Atom, comments: readonly Comment[]): ZoneGroup[] {
  const hl = headLine(atom);
  const atomComments = comments.filter((c) => c.atomHash === atom.hash);
  const byLine = new Map<number, Comment[]>();

  for (const comment of atomComments) {
    const anchorLine = comment.line !== null ? comment.line : hl;
    const bucket = byLine.get(anchorLine);
    if (bucket !== undefined) bucket.push(comment);
    else byLine.set(anchorLine, [comment]);
  }

  // The headLine zone always exists (holds the composer even when there are no comments).
  if (!byLine.has(hl)) byLine.set(hl, []);

  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, lineComments]) => ({ line, comments: lineComments, isComposer: line === hl }));
}

/** Changes to atoms, comments, answers, status, or resolved lines invalidate painted zones. */
function signatureOf(atoms: readonly Atom[], comments: readonly Comment[]): string {
  const hashes = new Set(atoms.map((atom) => atom.hash));
  const relevant = comments
    .filter((comment) => hashes.has(comment.atomHash))
    .map(
      (comment) =>
        `${comment.id}@${comment.ts}:${comment.status}:${comment.answer !== null ? "answered" : "open"}:${comment.line ?? "null"}`,
    )
    .join(",");
  return `${atoms.map((atom) => atom.hash).join(",")}|${relevant}`;
}

// All classes are `cd-`-namespaced: a comment zone's DOM lives inside Monaco's view,
// whose own elements use generic classes — a generic class here would collide with them.
function zoneNode(atom: Atom, group: ZoneGroup, store: AppStore): HTMLElement {
  const items = group.comments.map(commentItem);
  return el("div", { class: "cd-comment-thread" }, [
    items.length > 0 ? el("div", { class: "cd-comment-thread__list" }, items) : null,
    group.isComposer ? composer(atom, store) : null,
  ]);
}

function commentItem(comment: Comment): HTMLElement {
  const statusEl = el("span", {
    class: `cd-comment__status cd-comment__status--${comment.status}`,
    text: comment.status,
    attrs: { "aria-label": comment.status === "addressed" ? "Addressed" : "Open" },
  });

  // Show a "line N" badge when the comment is pinned to a specific within-hunk line.
  const headerChildren: (HTMLElement | null)[] = [statusEl];
  if (comment.line !== null) {
    headerChildren.push(
      el("span", { class: "cd-comment__line", text: `line ${comment.line}`, title: "Anchored to this line" }),
    );
  }

  // Body is human-authored text — escaped by el() via textContent.
  const body = el("p", { class: "cd-comment__body", text: comment.body });
  const item = el("div", { class: "cd-comment" }, [
    el("div", { class: "cd-comment__header" }, headerChildren),
    body,
  ]);

  if (comment.answer !== null) {
    // Answer is untrusted agent overlay (ADR-0004): rendered via renderMarkdown.
    const answerEl = el("div", { class: "cd-comment__answer" });
    answerEl.innerHTML = renderMarkdown(comment.answer);
    item.append(answerEl);
  }

  return item;
}

/**
 * Voice-first composer: collapsed to a button until opened; the textarea takes OS dictation.
 * Shows a line picker (optional select over the atom's added lines) so the human can pin
 * the comment to a specific within-hunk line (ADR-0012 §2).
 */
function composer(atom: Atom, store: AppStore): HTMLElement {
  const wrap = el("div", { class: "cd-composer" });

  function collapse(): void {
    wrap.replaceChildren(
      el("button", { class: "cd-composer__open", text: "💬 Comment", title: "Add a comment", onClick: open }),
    );
  }

  function open(): void {
    const input = el("textarea", {
      class: "cd-composer__input",
      attrs: { rows: "3", placeholder: "Speak or type your comment…" },
    });

    // Line picker: present only when the atom has added lines to pin to.
    const { node: pickerNode, getPointer } = linePicker(atom);

    const accept = el("button", {
      class: "cd-composer__accept",
      text: "Accept",
      onClick: () => {
        const body = input.value.trim();
        if (body === "") {
          collapse();
        } else {
          void store.comment(atom.hash, body, getPointer());
          collapse();
        }
      },
    });
    const cancel = el("button", { class: "cd-composer__cancel", text: "Cancel", onClick: collapse });
    wrap.replaceChildren(pickerNode, input, el("div", { class: "cd-composer__actions" }, [cancel, accept]));
    input.focus();
  }

  collapse();
  return wrap;
}

/**
 * A <select> showing the atom's added lines so the human can optionally pin the comment
 * to one. Returns the node and a `getPointer` that reads the current selection.
 * Returns a hidden stub and a no-op `getPointer` for atoms with no added lines (pure deletions).
 */
function linePicker(atom: Atom): { node: HTMLElement; getPointer: () => CommentLinePointer | undefined } {
  const addedLines = atom.lines.filter((l) => l.kind === "added");

  if (addedLines.length === 0) {
    // Pure deletion — nothing to pin to. Return a hidden placeholder so the composer's
    // replaceChildren call doesn't have to special-case the absence of a picker node.
    const node = el("div", { class: "cd-composer__line-pick" });
    node.hidden = true;
    return { node, getPointer: () => undefined };
  }

  const select = document.createElement("select");
  select.className = "cd-composer__line-select";

  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "Whole change block";
  select.appendChild(noneOpt);

  for (const line of addedLines) {
    const opt = document.createElement("option");
    // Use line text as the option value so getPointer() needs no index lookup.
    opt.value = line.text;
    opt.textContent = `Line: ${truncate(line.text, 60)}`;
    select.appendChild(opt);
  }

  const label = el("label", { class: "cd-composer__line-pick" });
  label.append(document.createTextNode("Pin to: "), select);

  function getPointer(): CommentLinePointer | undefined {
    const text = select.value;
    return text !== "" ? { side: "added", text } : undefined;
  }

  return { node: label, getPointer };
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
}
