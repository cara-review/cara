// Parse `git diff -U0 --histogram -M` output into the domain-neutral RawHunk
// contract (ADR-0003). Pure: no IO, no git. All git-specific shapes (`@@`
// headers, `a/`/`b/` prefixes, `/dev/null`) are consumed here and never leak.

import type { ChangeStatus, DiffLine, RawHunk } from "@cara/core";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Strip git's `a/` or `b/` path prefix. `/dev/null` passes through unchanged.
 * git appends a tab to a `---`/`+++` path that contains a space (a delimiter, so
 * the name's own trailing whitespace stays unambiguous); that tab is removed first.
 */
function stripPrefix(pathToken: string): string {
  const token = pathToken.replace(/\t$/, "");
  return token === "/dev/null" ? token : token.replace(/^[ab]\//, "");
}

interface FileHeader {
  readonly status: ChangeStatus;
  readonly path: string;
  readonly previousPath: string | null;
}

/** Resolve status and paths from the lines preceding the first hunk of a file section. */
function parseHeader(headerLines: readonly string[]): FileHeader {
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let minusPath: string | null = null;
  let plusPath: string | null = null;
  let added = false;
  let deleted = false;

  for (const line of headerLines) {
    if (line.startsWith("new file mode")) added = true;
    else if (line.startsWith("deleted file mode")) deleted = true;
    else if (line.startsWith("rename from ")) renameFrom = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) renameTo = line.slice("rename to ".length);
    else if (line.startsWith("--- ")) minusPath = stripPrefix(line.slice(4));
    else if (line.startsWith("+++ ")) plusPath = stripPrefix(line.slice(4));
  }

  if (renameFrom !== null && renameTo !== null) {
    return { status: "renamed", path: renameTo, previousPath: renameFrom };
  }
  if (added) return { status: "added", path: requirePath(plusPath), previousPath: null };
  if (deleted) return { status: "deleted", path: requirePath(minusPath), previousPath: null };
  // Modified: prefer the new-side path, fall back to the old side.
  const path = plusPath && plusPath !== "/dev/null" ? plusPath : minusPath;
  return { status: "modified", path: requirePath(path), previousPath: null };
}

/** A file section with hunks must carry a real path; an empty one signals a parse failure. */
function requirePath(path: string | null): string {
  if (path === null || path === "" || path === "/dev/null") {
    throw new Error("parse-diff: file section has hunks but no path");
  }
  return path;
}

/** Parse the body lines of one `@@` hunk into typed DiffLines. */
function parseHunkLines(bodyLines: readonly string[]): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const line of bodyLines) {
    if (line.startsWith("+")) lines.push({ kind: "added", text: line.slice(1) });
    else if (line.startsWith("-")) lines.push({ kind: "removed", text: line.slice(1) });
    // `\ No newline at end of file` and any stray context are ignored.
  }
  return lines;
}

/** Split stdout into file sections, each starting at a `diff --git ` line. */
function splitFileSections(stdout: string): string[][] {
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = [];
      sections.push(current);
    } else if (current !== null) {
      current.push(line);
    }
  }
  return sections;
}

/** Parse one file section into its hunks (zero when the change has no `@@` content). */
function parseFileSection(sectionLines: readonly string[]): RawHunk[] {
  const firstHunk = sectionLines.findIndex((l) => HUNK_HEADER.test(l));
  // No `@@` content (pure rename, mode-only, binary) is not an atom (ADR-0002).
  if (firstHunk === -1) return [];
  const header = parseHeader(sectionLines.slice(0, firstHunk));

  const hunks: RawHunk[] = [];
  let match: RegExpMatchArray | null = null;
  let body: string[] = [];

  const flush = (): void => {
    if (!match) return;
    hunks.push({
      status: header.status,
      path: header.path,
      previousPath: header.previousPath,
      oldStart: Number(match[1]),
      oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newLines: match[4] === undefined ? 1 : Number(match[4]),
      lines: parseHunkLines(body),
    });
  };

  for (const line of sectionLines.slice(firstHunk)) {
    const hunkMatch = line.match(HUNK_HEADER);
    if (hunkMatch) {
      flush();
      match = hunkMatch;
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return hunks;
}

/** Parse full `git diff -U0 --histogram -M` stdout into RawHunks, in git order. */
export function parseDiff(stdout: string): RawHunk[] {
  return splitFileSections(stdout).flatMap(parseFileSection);
}
