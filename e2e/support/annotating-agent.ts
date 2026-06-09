// A deterministic GroupingAgent that, unlike the default bootReal grouping, emits
// Chapter and Section summaries — so the e2e suite can drive the AI-summary band.
// Each summary carries an HTML-injection probe: the band must render the agent's
// markdown safely (ADR-0004 — renderMarkdown: markdown-it html:false + DOMPurify),
// so the literal tag appears as inert text, never as a live element.
// If escaping ever regressed, the injected <img> would fire onerror and set window.__xss.

import type { Atom } from "@clear-diff/core";
import type { GroupingAgent } from "./server.ts";

export const XSS_PROBE = `<img src=x onerror="window.__xss = true">`;

export class AnnotatingAgent implements GroupingAgent {
  grouping(atoms: readonly Atom[]): unknown {
    const byFile = new Map<string, string[]>();
    for (const atom of atoms) {
      const hashes = byFile.get(atom.path);
      if (hashes) hashes.push(atom.hash);
      else byFile.set(atom.path, [atom.hash]);
    }

    const sections = [...byFile].map(([path, atomHashes]) => ({
      title: path,
      summary: `Overview of ${path} ${XSS_PROBE}`,
      atomHashes,
    }));

    return {
      chapters: [{ title: "Changes", summary: `Chapter overview ${XSS_PROBE}`, sections }],
    };
  }
}
