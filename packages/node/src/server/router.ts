// The tRPC router (ADR-0003, ADR-0008): the typed contract the web client is built
// against and the driving adapter over the inbound ReviewService + WorkspaceReader.
// zod validates every input at the boundary — the untrusted edge (a loopback server
// is reachable by any page), so path containment lives here too. Transport-free: no
// sockets, no Bun, no node builtins — so this module's *type* can be imported across
// the web↔node seam (type-only, runtime-erased) without dragging server code into
// the web bundle. The node:http + ws wiring that carries this router lives in server.ts.
//
// Author tier is channel-inferred (ADR-0011 §5). Two classes of write live here:
//   - Tier-bearing writes (mark/unmark/comment/done/reshapeRequest): a browser session,
//     so `ctx.author` is the fixed human tier — no input can forge it. The CLI agent never
//     reaches these; it submits over the `submit` verb, stamped agent (compose path).
//   - Tier-neutral operations (the `reshape` grouping handover, ADR-0012 §4): a grouping
//     carries no author, so `present`'s live-server handover client may call it from the
//     CLI channel with no tier-forgery surface — `presentGrouping` reads no author at all.

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type {
  AtomHash,
  ClockPort,
  DiffSpec,
  MarkAuthor,
  ReviewService,
  WorkspaceReader,
} from "@cara/core";
import { reviewContext, SummariesRequiredError } from "@cara/core";
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
  /**
   * Tell connected browsers to reconnect (ADR-0012 §4) — the `reshape` handover's
   * live-refresh: on reconnect the browser re-runs the `snapshot` query and picks up the
   * new grouping. Wired by the transport (server.ts) over the existing tRPC-ws handler;
   * no new streaming channel (stays within ADR-0008's query/mutation contract).
   */
  readonly broadcastReconnect?: () => void;
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
      .input(
        z.object({
          context: contextSchema,
          atomHash: atomHashSchema,
          body: z.string().min(1, "comment body must not be empty").max(4000, "comment body is too long"),
          /** Optional within-hunk line pointer (ADR-0012 §2): content + side, never a number. */
          line: z
            .object({
              side: z.enum(["added", "removed"]),
              // Bounded like `body` (CWE-770): a pointer is one source line, persisted verbatim
              // into the append-only log on every comment — the one free-text field that escaped
              // the cap. 1000 chars covers the longest plausible diff line.
              text: z.string().min(1, "line text must not be empty").max(1000, "line text is too long"),
            })
            .optional(),
        }),
      )
      .mutation(({ input, ctx }) => {
        deps.activity.touch();
        return deps.service.comment(
          reviewContext(input.context),
          input.atomHash as AtomHash,
          input.body,
          ctx.author,
          input.line,
        );
      }),

    /**
     * The `present` live-server handover (ADR-0012 §4): the CLI present-client hands a new
     * grouping to this running server so a re-present refreshes the live review rather than
     * booting a sibling. Tier-neutral — `presentGrouping` reads no author (it carries none),
     * so this is the one write that may arrive from the CLI channel. The grouping is untrusted
     * (repair + the summary gate are the backstop). On success, reconnect-broadcast tells
     * connected browsers to re-load the now-current snapshot. `spec` (boot-fixed) is
     * authoritative; `context` is the addressing key the client matched in discovery.
     *
     * `requireSummaries` carries the gate decision the present-client already made
     * (ADR-0012 §1): true for an agent-authored grouping, false for the engine's git-order
     * floor — which is exempt and must never be rejected, here or anywhere. Defaults true so
     * an omitting caller still gets the gate. A `SummariesRequiredError` (the one rejection
     * this handover backstops) is surfaced via `UserFacingError`, never masked to "Internal
     * error.".
     */
    reshape: t.procedure
      .input(z.object({ context: contextSchema, grouping: z.unknown(), requireSummaries: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        let snapshot;
        try {
          snapshot = await deps.service.presentGrouping(deps.spec, input.grouping, {
            requireSummaries: input.requireSummaries ?? true,
          });
        } catch (error) {
          if (error instanceof SummariesRequiredError) throw new UserFacingError(error.message);
          throw error;
        }
        deps.broadcastReconnect?.();
        return snapshot;
      }),

    /**
     * A human Reshape request (ADR-0012 §3): a review-level note asking the agent to
     * regroup. Human-only by channel (this router serves the browser) — never invoked from
     * the CLI, which has no present-client method for it. The agent reads it on `dispatch`
     * and responds by re-presenting; re-presenting clears it (a fresh `presented` marker).
     */
    reshapeRequest: t.procedure
      .input(
        z.object({
          context: contextSchema,
          // Bounded so a loopback page can't bloat the append-only log (CWE-770), matching
          // the reviewer-label / wait-window bounds elsewhere. A reshape note is short prose.
          body: z.string().min(1, "reshape body must not be empty").max(2000, "reshape body is too long"),
        }),
      )
      .mutation(({ input }) => {
        deps.activity.touch();
        return deps.service.requestReshape(reviewContext(input.context), input.body);
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
