// A deterministic AgentPort that, unlike FakeAgent, emits Chapter and Section
// summaries — so the e2e suite can drive the AI-summary band. Each summary carries
// an HTML-injection probe: the band must render it as inert text (ADR-0004), never
// as markup. If escaping ever regressed, the injected <img> would fire onerror and
// set window.__xss.

import type { AgentPort, GroupingRequest } from "@clear-diff/core";

export const XSS_PROBE = `<img src=x onerror="window.__xss = true">`;

export class AnnotatingAgent implements AgentPort {
  proposeGrouping(request: GroupingRequest): Promise<unknown> {
    const byFile = new Map<string, string[]>();
    for (const atom of request.atoms) {
      const hashes = byFile.get(atom.path);
      if (hashes) hashes.push(atom.hash);
      else byFile.set(atom.path, [atom.hash]);
    }

    const sections = [...byFile].map(([path, atomHashes]) => ({
      title: path,
      summary: `Overview of ${path} ${XSS_PROBE}`,
      atomHashes,
    }));

    return Promise.resolve({
      chapters: [{ title: "Changes", summary: `Chapter overview ${XSS_PROBE}`, sections }],
    });
  }
}
