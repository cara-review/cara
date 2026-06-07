// FakeAgent: a deterministic AgentPort for offline pipeline tests (ADR-0004).
//
// The agent is the one untrusted port: it may arrange and describe, never define
// or alter the change. So this returns only ids + titles (never the diff lines),
// typed `unknown` at the seam — core's repairGrouping owns coercion.

import type { AgentChat, AgentPort, ChatRequest, GroupingRequest } from "@clear-diff/core";

// The untrusted proposal overlay repairGrouping targets. Adapter-local: the
// domain never names this shape — it arrives there as `unknown` (ADR-0004).
interface ProposedSection {
  readonly title: string;
  readonly atomHashes: readonly string[];
}
interface ProposedChapter {
  readonly title: string;
  readonly sections: readonly ProposedSection[];
}
interface ProposedGrouping {
  readonly chapters: readonly ProposedChapter[];
}

/**
 * Groups the real atom set into one chapter with a section per file, in
 * first-appearance order, atoms in git order. Deterministic: the same atom set
 * always yields a deep-equal proposal.
 */
export class FakeAgent implements AgentPort {
  proposeGrouping(request: GroupingRequest): Promise<unknown> {
    const byFile = new Map<string, string[]>();
    for (const atom of request.atoms) {
      const hashes = byFile.get(atom.path);
      if (hashes) hashes.push(atom.hash);
      else byFile.set(atom.path, [atom.hash]);
    }

    const sections: ProposedSection[] = [...byFile].map(([path, atomHashes]) => ({
      title: path,
      atomHashes,
    }));

    const grouping: ProposedGrouping = { chapters: [{ title: "Changes", sections }] };
    return Promise.resolve(grouping);
  }
}

/**
 * FakeAgentChat: a deterministic AgentChat for offline Q&A tests (ADR-0009). Echoes
 * the question and the Chapter's size so a test can assert the round-trip without an
 * LLM. Returns `unknown` at the seam, like the real adapter — core validates it.
 */
export class FakeAgentChat implements AgentChat {
  answer(request: ChatRequest): Promise<unknown> {
    const count = request.atoms.length;
    const noun = count === 1 ? "change" : "changes";
    return Promise.resolve({
      answer: `You asked: "${request.question}". This Chapter has ${count} ${noun}.`,
    });
  }
}
