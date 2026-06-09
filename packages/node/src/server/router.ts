// The tRPC router (ADR-0003, ADR-0008): the typed contract the web client is built
// against and the driving adapter over the inbound ReviewService + WorkspaceReader.
// zod validates every input at the boundary — the untrusted edge (a loopback server
// is reachable by any page), so path containment lives here too. Transport-free: no
// sockets, no Bun, no node builtins — so this module's *type* can be imported across
// the web↔node seam (type-only, runtime-erased) without dragging server code into
// the web bundle. The node:http + ws wiring that carries this router lives in server.ts.
//
// Author tier is channel-inferred (ADR-0011 §5): every mutation over this router is a
// browser session, so `ctx.author` is the fixed human tier — no input can forge it.
// The CLI agent never reaches this router for writes; it submits over the `submit`
// verb, which stamps the agent tier (server/compose path, not here).

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type {
  AtomHash,
  ClockPort,
  DiffSpec,
  MarkAuthor,
  ReviewService,
  WorkspaceReader,
} from "@clear-diff/core";
import { reviewContext } from "@clear-diff/core";
import { UserFacingError } from "../user-facing-error.ts";
import { classifyWait, type ReviewActivity } from "./activity.ts";

/** The driving adapter's view of the backend: the inbound port + evidence reader + boot spec. */
export interface RpcDeps {
  readonly service: ReviewService;
  readonly workspace: WorkspaceReader;
  readonly spec: DiffSpec;
  /** UI-activity tracker for `dispatch --wait` (ADR-0011 §4). */
  readonly activity: ReviewActivity;
  /** The clock the `wait` decision compares against — fixed in tests. */
  readonly clock: ClockPort;
}

/** Per-connection context. A browser session is always the human tier (ADR-0011 §5). */
export interface RpcContext {
  readonly author: MarkAuthor;
}

const t = initTRPC.context<RpcContext>().create({
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

/** How often the blocking `wait` re-checks activity while still pending. */
const WAIT_TICK_MS = 250;
/** Block at most this long before returning `reviewInProgress` (ADR-0011 §4). */
const DEFAULT_MAX_BLOCK_MS = 240_000;
/** No UI activity for this long → `reviewIdle` (the human walked away). */
const DEFAULT_IDLE_MS = 300_000;
/** Upper bound on a caller-supplied wait window — caps a loopback page parking a block (CWE-770). */
const MAX_WAIT_MS = 1_800_000;

/** A repo-relative path that stays within the repository: no absolute, no `..` escape (CWE-22). */
function isContainedRepoPath(value: string): boolean {
  if (value === "" || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return !value.split(/[\\/]/).includes("..");
}

const contextSchema = z.string().refine((s) => s.trim() !== "", "context must not be empty");
const atomHashSchema = z.string().min(1, "atomHash must not be empty");
const commentIdSchema = z.string().min(1, "commentId must not be empty");
const dispositionSchema = z.enum(["done", "skipped"]);
const sideSchema = z.enum(["base", "head"]);
const repoPathSchema = z
  .string()
  .refine(isContainedRepoPath, "path must be a repo-relative path that stays within the repository");
// Also reject a leading "-" so the path can't be read as an editor flag (CWE-88).
const editorPathSchema = repoPathSchema.refine((p) => !p.startsWith("-"), 'path must not start with "-"');

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
    /** Current snapshot — the browser's boot load and re-poll read (ADR-0011, Risk seam #3). */
    snapshot: t.procedure
      .input(z.object({ context: contextSchema }))
      .query(({ input }) => deps.service.snapshot(reviewContext(input.context))),

    mark: t.procedure
      .input(z.object({ context: contextSchema, atomHash: atomHashSchema, disposition: dispositionSchema }))
      .mutation(({ input, ctx }) => {
        deps.activity.touch();
        return deps.service.mark(reviewContext(input.context), input.atomHash as AtomHash, input.disposition, ctx.author);
      }),

    unmark: t.procedure
      .input(z.object({ context: contextSchema, atomHash: atomHashSchema }))
      .mutation(({ input, ctx }) => {
        deps.activity.touch();
        return deps.service.unmark(reviewContext(input.context), input.atomHash as AtomHash, ctx.author);
      }),

    comment: t.procedure
      .input(z.object({ context: contextSchema, atomHash: atomHashSchema, body: z.string() }))
      .mutation(({ input, ctx }) => {
        deps.activity.touch();
        return deps.service.comment(reviewContext(input.context), input.atomHash as AtomHash, input.body, ctx.author);
      }),

    answer: t.procedure
      .input(z.object({ context: contextSchema, commentId: commentIdSchema, body: z.string() }))
      .mutation(({ input, ctx }) => {
        deps.activity.touch();
        return deps.service.answer(reviewContext(input.context), input.commentId, input.body, ctx.author);
      }),

    /**
     * The human "done reviewing" signal (ADR-0011 §4) — flips `dispatch --wait` to done.
     * Human-only by channel: this router serves the browser, so "done" is definitionally a
     * human act; no author is read because completion carries no tier.
     */
    done: t.procedure.input(z.object({ context: contextSchema })).mutation(async ({ input }) => {
      deps.activity.complete();
      await deps.service.markComplete(reviewContext(input.context));
      return null;
    }),

    /**
     * Block until the review settles, returning one of three states (ADR-0011 §4). The
     * CLI agent calls this over WS for `dispatch --wait`. The decision is pure
     * (`classifyWait`) over the injected clock; the loop sleeps in real time but returns
     * immediately the moment a terminal condition holds, so a fixed-clock test never sleeps.
     */
    wait: t.procedure
      .input(
        z.object({
          context: contextSchema,
          // Bounded so a hostile loopback page can't pin a long-lived server block (CWE-770).
          maxBlockMs: z.number().int().positive().max(MAX_WAIT_MS).optional(),
          idleMs: z.number().int().positive().max(MAX_WAIT_MS).optional(),
        }),
      )
      .query(async ({ input, signal }) => {
        const context = reviewContext(input.context);
        const maxBlockMs = input.maxBlockMs ?? DEFAULT_MAX_BLOCK_MS;
        const idleMs = input.idleMs ?? DEFAULT_IDLE_MS;
        const startTs = deps.clock.now();
        for (;;) {
          const { lastActivityTs, completed } = deps.activity.state();
          const decision = classifyWait({
            completed,
            lastActivityTs,
            now: deps.clock.now(),
            startTs,
            idleMs,
            maxBlockMs,
          });
          if (decision === "done") {
            return { state: "done", view: await deps.service.dispatch(deps.spec) } as const;
          }
          if (decision !== "pending" || signal?.aborted) {
            const { progress } = await deps.service.snapshot(context);
            return { state: decision === "reviewIdle" ? "reviewIdle" : "reviewInProgress", progress } as const;
          }
          await delay(WAIT_TICK_MS, signal);
        }
      }),

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
