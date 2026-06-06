// Pure transform: a Section's atoms → the diff surface's render model. DOM-free and
// unit-tested. The surface renders changed lines as change-block / gap / change-block
// across files; this module owns the structural truth (file grouping, gap spans, per-line
// numbers) so the DOM renderer stays dumb. Adapter words ("hunk") never leak — a block is
// just an atom's changed lines; a gap is the elided head-side context between two blocks.

import type { Atom, ChangeStatus, Section } from "../protocol.ts";

export interface NumberedLine {
  readonly kind: "added" | "removed";
  readonly text: string;
  /** Line number on the side the change lands: head for added, base for removed. */
  readonly lineNo: number;
}

/** The elided head-side context preceding a block within the same file. */
export interface Gap {
  readonly hiddenLines: number;
  /** Inclusive 1-indexed head-side range to fetch when expanding. */
  readonly headStart: number;
  readonly headEnd: number;
}

export interface DiffBlock {
  readonly atom: Atom;
  /** Context elided between the previous block of this file and this one; null if adjacent/first. */
  readonly gap: Gap | null;
  /** Head-side line to open the editor at for this block. */
  readonly headStart: number;
}

export interface FileGroup {
  readonly path: string;
  readonly status: ChangeStatus;
  readonly previousPath: string | null;
  readonly blocks: readonly DiffBlock[];
}

/** Walk an atom's lines, assigning each its number on the side it lands. */
export function numberedLines(atom: Atom): readonly NumberedLine[] {
  let oldLineNo = atom.oldStart;
  let newLineNo = atom.newStart;
  return atom.lines.map((line) =>
    line.kind === "removed"
      ? { kind: line.kind, text: line.text, lineNo: oldLineNo++ }
      : { kind: line.kind, text: line.text, lineNo: newLineNo++ },
  );
}

/**
 * Head-side context elided between a preceding block and the next, or null if none.
 * A pure deletion has `newLines === 0` and its `newStart` is the head line *before* the
 * removed content (git `-U0`: `@@ -5,2 +4,0 @@`), so its block occupies no head line and
 * the context resumes one line later — `Math.max(newLines, 1)` accounts for that on the
 * left, and a zero-length next block keeps its `newStart` line in the gap on the right.
 */
function gapBetween(previous: Atom, next: Atom): Gap | null {
  const headStart = previous.newStart + Math.max(previous.newLines, 1);
  const headEnd = next.newLines === 0 ? next.newStart : next.newStart - 1;
  const hiddenLines = headEnd - headStart + 1;
  return hiddenLines > 0 ? { hiddenLines, headStart, headEnd } : null;
}

/** Group a Section's atoms into file cards (by consecutive path) with gap spans. */
export function diffModel(section: Section): readonly FileGroup[] {
  const groups: FileGroup[] = [];
  let current: { path: string; status: ChangeStatus; previousPath: string | null; blocks: DiffBlock[] } | null = null;

  for (const atom of section.atoms) {
    if (current === null || current.path !== atom.path) {
      current = { path: atom.path, status: atom.status, previousPath: atom.previousPath, blocks: [] };
      groups.push(current);
      current.blocks.push({ atom, gap: null, headStart: atom.newStart });
      continue;
    }
    const previous = current.blocks[current.blocks.length - 1]?.atom ?? atom;
    current.blocks.push({ atom, gap: gapBetween(previous, atom), headStart: atom.newStart });
  }

  return groups;
}
