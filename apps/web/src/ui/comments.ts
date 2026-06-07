// Inline comment threads on the diff surface (ADR-0006, ADR-0007). Each atom in a
// file card gets a Monaco *view zone* anchored to its head line, holding the
// existing thread plus a voice-first composer (OS dictation types into the
// textarea). View zones are a Monaco/adapter concern — the domain never names them.
//
// Comments anchor to atoms by hash (ADR-0002), never to raw line numbers. Bodies
// are user text rendered via textContent (the `el` factory) — escaped by
// construction, never interpreted as markup (ADR-0004). (The ADR-0007 agent-drafting
// seam is an open question, deliberately unwired: the composer takes dictation direct.)

import * as monaco from "monaco-editor";
import { el } from "../dom.ts";
import type { Atom, Comment } from "../protocol.ts";
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

  function relayout(zone: Zone): void {
    zone.view.heightInPx = zone.node.scrollHeight;
    editor.changeViewZones((accessor) => accessor.layoutZone(zone.id));
  }

  function update(comments: readonly Comment[]): void {
    const next = signatureOf(atoms, comments);
    if (next === signature) return; // nothing relevant changed (e.g. a mark landed) — keep focus
    signature = next;
    clear();
    editor.changeViewZones((accessor) => {
      for (const atom of atoms) {
        const node = threadNode(
          atom,
          comments.filter((comment) => comment.atomHash === atom.hash),
          store,
        );
        const view: monaco.editor.IViewZone = { afterLineNumber: headLine(atom), domNode: node, heightInPx: 0 };
        const observer = new ResizeObserver(() => relayout(zone));
        const zone: Zone = { view, id: accessor.addZone(view), node, observer };
        observer.observe(node);
        zones.push(zone);
      }
    });
  }

  return { update, dispose: clear };
}

/** The atom's last head line; for a pure deletion, the line it sits after. */
function headLine(atom: Atom): number {
  return atom.newLines > 0 ? atom.newStart + atom.newLines - 1 : Math.max(atom.newStart, 0);
}

/** A change to either the atom set or its comments invalidates the painted zones. */
function signatureOf(atoms: readonly Atom[], comments: readonly Comment[]): string {
  const hashes = new Set(atoms.map((atom) => atom.hash));
  const relevant = comments
    .filter((comment) => hashes.has(comment.atomHash))
    .map((comment) => `${comment.atomHash}@${comment.ts}`)
    .join(",");
  return `${atoms.map((atom) => atom.hash).join(",")}|${relevant}`;
}

// All classes are `cd-`-namespaced: a comment zone's DOM lives inside Monaco's view,
// whose own elements use generic classes (gutter, margin, view-line…) — a generic
// class here would bleed into / collide with Monaco's styles.
function threadNode(atom: Atom, thread: readonly Comment[], store: AppStore): HTMLElement {
  const items = thread.map((comment) => el("p", { class: "cd-comment__body", text: comment.body }));
  return el("div", { class: "cd-comment-thread" }, [
    items.length > 0 ? el("div", { class: "cd-comment-thread__list" }, items) : null,
    composer(atom, store),
  ]);
}

/** Voice-first composer: collapsed to a button until opened; the textarea takes OS dictation. */
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
    const accept = el("button", {
      class: "cd-composer__accept",
      text: "Accept",
      onClick: () => {
        const body = input.value.trim();
        if (body === "") collapse();
        else void store.comment(atom.hash, body); // accept → snapshot repaints the thread
      },
    });
    const cancel = el("button", { class: "cd-composer__cancel", text: "Cancel", onClick: collapse });
    wrap.replaceChildren(input, el("div", { class: "cd-composer__actions" }, [cancel, accept]));
    input.focus();
  }

  collapse();
  return wrap;
}
