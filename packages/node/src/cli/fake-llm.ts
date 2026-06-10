// A deterministic PorcelainLlm stub for `--fake` and tests (ADR-0011). No network,
// no key. It groups every change into one section, accounts for every change in a lens
// pass (so the gap report converges), and returns a canned answer — enough to exercise
// the full wrapper loop offline.

import type { AnswerRequest, GroupingRequest, LensFindings, LensRequest, PorcelainLlm } from "./llm.ts";

export class FakeLlm implements PorcelainLlm {
  group(req: GroupingRequest): Promise<unknown> {
    // Summaries are mandatory (ADR-0012 §1); a compliant LLM supplies one per chapter/section.
    return Promise.resolve({
      chapters: [
        {
          title: "Review",
          summary: "All changes in this review.",
          sections: [{ title: "Changes", summary: "Every change, grouped together.", atomHashes: req.atoms.map((a) => a.hash) }],
        },
      ],
    });
  }

  review(req: LensRequest): Promise<LensFindings> {
    const marks = req.atoms.map((a) => ({ atomHash: a.hash, disposition: "done" as const }));
    const first = req.atoms[0];
    const comments = first ? [{ atomHash: first.hash, body: `Reviewed under this lens.` }] : [];
    return Promise.resolve({ marks, comments });
  }

  answer(req: AnswerRequest): Promise<string> {
    return Promise.resolve(`Reviewed ${req.atoms.length} change(s); no concern.`);
  }
}
