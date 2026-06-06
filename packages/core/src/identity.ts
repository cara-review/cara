// Content-hash atom identity (ADR-0002).
//
// Identity = sha256(path + NUL + payload), where payload is the added/removed
// lines, normalised, in git order. Context is excluded (there is none under
// `-U0`). Path is included so identical payloads in different files are distinct
// atoms. Ranges (line numbers) are excluded so an unrelated upstream shift does
// not disturb a mark.

import type { AtomHash, DiffLine, RawHunk } from "./model.ts";
import { sha256Hex } from "./hash/sha256.ts";

/** Normalise a line for hashing: line endings to `\n`, trailing whitespace stripped. */
function normalizeLine(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t]+$/, "");
}

/** Serialise a hunk's payload: `+`/`-` prefixed normalised lines, git order, `\n`-joined. */
export function atomPayload(lines: readonly DiffLine[]): string {
  return lines.map((l) => (l.kind === "added" ? "+" : "-") + normalizeLine(l.text)).join("\n");
}

/** Compute the content-hash identity of a hunk. */
export function hashAtom(hunk: RawHunk): AtomHash {
  return sha256Hex(hunk.path + "\0" + atomPayload(hunk.lines)) as AtomHash;
}
