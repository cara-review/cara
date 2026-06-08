// The tRPC router (ADR-0003, ADR-0008): the typed contract the web client is built
// against and the driving adapter over the inbound ReviewService + WorkspaceReader.
// zod validates every input at the boundary — the untrusted edge (a loopback server
// is reachable by any page), so path containment lives here too. Transport-free: no
// sockets, no Bun, no node builtins — so this module's *type* can be imported across
// the web↔node seam (type-only, runtime-erased) without dragging server code into
// the web bundle. The node:http + ws wiring that carries this router lives in server.ts.

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type {
  AtomHash,
  DiffSpec,
  ReviewService,
  ReviewSnapshot,
  WorkspaceReader,
} from "@clear-diff/core";
import { reviewContext } from "@clear-diff/core";
import { UserFacingError } from "../user-facing-error.ts";

/** The driving adapter's view of the backend: the inbound port + evidence reader + boot spec. */
export interface RpcDeps {
  readonly service: ReviewService;
  readonly workspace: WorkspaceReader;
  readonly spec: DiffSpec;
}

/**
 * What the `open` subscription streams: live grouping progress (an elapsed tick
 * while the agent works), then the resolved Section titles revealed one by one (the
 * scrolling UX), then the final snapshot. Progress is synthesised in the transport
 * layer — the core grouping stays a single use-case, no new port (ADR-0008).
 */
export type OpenEvent =
  | { readonly kind: "progress"; readonly elapsedMs: number }
  | { readonly kind: "section"; readonly title: string }
  | { readonly kind: "snapshot"; readonly snapshot: ReviewSnapshot };

const t = initTRPC.create({
  // The peer may be a remote page, so never leak internals. UserFacingError carries a
  // curated, safe message; a malformed input is a zod BAD_REQUEST naming the bad field;
  // everything else (git stderr, fs paths) is masked to a generic string. The adapter's
  // onError still logs the full error server-side.
  errorFormatter({ error, shape }) {
    if (error.cause instanceof UserFacingError) return { ...shape, message: error.cause.message };
    if (error.code === "BAD_REQUEST") return shape;
    return { ...shape, message: "Internal error." };
  },
});

const PROGRESS_TICK_MS = 250;
/** Cap the title reveal so a huge review streams a taste, not thousands of frames. */
const MAX_REVEAL_TITLES = 12;

/** A repo-relative path that stays within the repository: no absolute, no `..` escape (CWE-22). */
function isContainedRepoPath(value: string): boolean {
  if (value === "" || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return !value.split(/[\\/]/).includes("..");
}

const contextSchema = z.string().refine((s) => s.trim() !== "", "context must not be empty");
const atomHashSchema = z.string().min(1, "atomHash must not be empty");
const dispositionSchema = z.enum(["done", "skipped"]);
const sideSchema = z.enum(["base", "head"]);
const repoPathSchema = z
  .string()
  .refine(isContainedRepoPath, "path must be a repo-relative path that stays within the repository");
// Also reject a leading "-" so the path can't be read as an editor flag (CWE-88).
const editorPathSchema = repoPathSchema.refine((p) => !p.startsWith("-"), 'path must not start with "-"');

function sectionTitles(snapshot: ReviewSnapshot): string[] {
  return snapshot.review.chapters.flatMap((chapter) => chapter.sections.map((section) => section.title));
}

/** A cancellable delay: resolves after `ms`, or immediately when the subscription aborts. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Build the router over the composed backend. `AppRouter` (its type) is the web contract. */
export function createAppRouter(deps: RpcDeps) {
  return t.router({
    /**
     * Open the review and stream grouping progress. The CLI fixes the DiffSpec at boot,
     * so this carries no input. Ticks elapsed while the agent groups, then reveals the
     * resolved Section titles, then the snapshot — all transport-layer, no core change.
     */
    open: t.procedure.subscription(async function* (opts) {
      const start = Date.now();
      let snapshot: ReviewSnapshot | undefined;
      let failure: unknown;
      const opening = deps.service.open(deps.spec).then(
        (result) => {
          snapshot = result;
        },
        (error: unknown) => {
          failure = error;
        },
      );

      while (snapshot === undefined && failure === undefined) {
        if (opts.signal?.aborted) return;
        await Promise.race([opening, delay(PROGRESS_TICK_MS, opts.signal)]);
        if (snapshot === undefined && failure === undefined && !opts.signal?.aborted) {
          yield { kind: "progress", elapsedMs: Date.now() - start } satisfies OpenEvent;
        }
      }
      if (failure !== undefined) throw failure;

      const ready = snapshot as ReviewSnapshot;
      for (const title of sectionTitles(ready).slice(0, MAX_REVEAL_TITLES)) {
        yield { kind: "section", title } satisfies OpenEvent;
      }
      yield { kind: "snapshot", snapshot: ready } satisfies OpenEvent;
    }),

    mark: t.procedure
      .input(z.object({ context: contextSchema, atomHash: atomHashSchema, disposition: dispositionSchema }))
      .mutation(({ input }) =>
        deps.service.mark(reviewContext(input.context), input.atomHash as AtomHash, input.disposition),
      ),

    unmark: t.procedure
      .input(z.object({ context: contextSchema, atomHash: atomHashSchema }))
      .mutation(({ input }) => deps.service.unmark(reviewContext(input.context), input.atomHash as AtomHash)),

    comment: t.procedure
      .input(z.object({ context: contextSchema, atomHash: atomHashSchema, body: z.string() }))
      .mutation(({ input }) =>
        deps.service.comment(reviewContext(input.context), input.atomHash as AtomHash, input.body),
      ),

    dispatch: t.procedure
      .input(z.object({ context: contextSchema }))
      .mutation(({ input }) => deps.service.dispatch(reviewContext(input.context))),

    ask: t.procedure
      .input(
        z.object({
          context: contextSchema,
          chapterIndex: z.number().int().nonnegative(),
          question: z.string().refine((q) => q.trim() !== "", "question must not be empty"),
        }),
      )
      .mutation(({ input }) => deps.service.ask(reviewContext(input.context), input.chapterIndex, input.question)),

    openInEditor: t.procedure
      .input(z.object({ path: editorPathSchema, line: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deps.service.openInEditor(input.path, input.line);
        return null;
      }),

    readFile: t.procedure
      .input(z.object({ path: repoPathSchema, side: sideSchema }))
      .query(async ({ input }) => ({ text: await deps.workspace.readFile(input.path, input.side) })),
  });
}

/** The router type — the single source of truth the web client imports (type-only). */
export type AppRouter = ReturnType<typeof createAppRouter>;
