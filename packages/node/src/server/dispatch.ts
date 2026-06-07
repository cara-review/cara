// RPC dispatch (ADR-0003): map a wire request onto the inbound ReviewService and
// the WorkspaceReader, returning a wire response. Pure of transport — no sockets,
// no JSON framing — so it unit-tests against fakes. Incoming messages are the
// untrusted boundary: parsed from `unknown`, validated (including path
// containment, since a loopback server is reachable by any web page), then
// dispatched.

import { isAbsolute, normalize, sep } from "node:path";
import type {
  AtomHash,
  DiffSpec,
  ReviewContext,
  ReviewService,
  WorkspaceReader,
} from "@clear-diff/core";
import { reviewContext } from "@clear-diff/core";
import { UserFacingError } from "../user-facing-error.ts";
import type { ClientRequest, Method, ResultMap, ServerResponse } from "./protocol.ts";

/** The driving adapter's view of the backend: the inbound port + evidence reader + boot spec. */
export interface RpcDeps {
  readonly service: ReviewService;
  readonly workspace: WorkspaceReader;
  readonly spec: DiffSpec;
}

/** A malformed request. Its message is safe to return to the client; other errors are masked. */
class RpcError extends Error {}

/** Validate and dispatch one request. Always resolves to a response — errors are data. */
export async function handleRequest(deps: RpcDeps, raw: unknown): Promise<ServerResponse> {
  const id = idOf(raw);
  try {
    const result = await dispatch(deps, parseRequest(raw));
    return { id, ok: true, result };
  } catch (error) {
    // RpcError (malformed request) and UserFacingError (a curated operational
    // failure, e.g. the agent timing out) both carry messages safe to return.
    if (error instanceof RpcError || error instanceof UserFacingError) {
      return { id, ok: false, error: error.message };
    }
    // Never leak git stderr or fs paths to the wire — the peer may be a remote page.
    console.error("clear-diff RPC error:", error);
    return { id, ok: false, error: "Internal error." };
  }
}

async function dispatch(deps: RpcDeps, request: ClientRequest): Promise<ResultMap[Method]> {
  switch (request.method) {
    case "open":
      return deps.service.open(deps.spec);
    case "mark":
      return deps.service.mark(request.params.context, request.params.atomHash, request.params.disposition);
    case "unmark":
      return deps.service.unmark(request.params.context, request.params.atomHash);
    case "comment":
      return deps.service.comment(request.params.context, request.params.atomHash, request.params.body);
    case "dispatch":
      return deps.service.dispatch(request.params.context);
    case "ask":
      return deps.service.ask(request.params.context, request.params.chapterIndex, request.params.question);
    case "openInEditor":
      await deps.service.openInEditor(request.params.path, request.params.line);
      return null;
    case "readFile":
      return { text: await deps.workspace.readFile(request.params.path, request.params.side) };
  }
}

function parseRequest(raw: unknown): ClientRequest {
  const record = asRecord(raw, "request");
  const id = str(record, "id");
  const method = str(record, "method");
  if (method === "open") return { id, method, params: {} };

  const params = asRecord(record["params"], "params");
  switch (method) {
    case "mark":
      return { id, method, params: { ...contextAndHash(params), disposition: disposition(params) } };
    case "unmark":
      return { id, method, params: contextAndHash(params) };
    case "comment":
      return { id, method, params: { ...contextAndHash(params), body: str(params, "body") } };
    case "dispatch":
      return { id, method, params: { context: reviewContext(str(params, "context")) } };
    case "ask":
      return {
        id,
        method,
        params: {
          context: reviewContext(str(params, "context")),
          chapterIndex: chapterIndex(params),
          question: nonEmptyStr(params, "question"),
        },
      };
    case "openInEditor":
      return { id, method, params: { path: editorPath(params), line: line(params) } };
    case "readFile":
      return { id, method, params: { path: repoPath(params), side: side(params) } };
    default:
      throw new RpcError(`Unknown method "${method}".`);
  }
}

function idOf(raw: unknown): string {
  if (typeof raw === "object" && raw !== null) {
    const id = (raw as Record<string, unknown>)["id"];
    if (typeof id === "string") return id;
  }
  return "";
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new RpcError(`${what} must be an object.`);
  return value as Record<string, unknown>;
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new RpcError(`"${key}" must be a string.`);
  return value;
}

function nonEmptyStr(record: Record<string, unknown>, key: string): string {
  const value = str(record, key);
  if (value.trim() === "") throw new RpcError(`"${key}" must not be empty.`);
  return value;
}

/** A Chapter index into the live review: a non-negative integer. Range is checked in the service. */
function chapterIndex(params: Record<string, unknown>): number {
  const value = params["chapterIndex"];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RpcError(`"chapterIndex" must be a non-negative integer.`);
  }
  return value;
}

function contextAndHash(params: Record<string, unknown>): {
  readonly context: ReviewContext;
  readonly atomHash: AtomHash;
} {
  return { context: reviewContext(str(params, "context")), atomHash: str(params, "atomHash") as AtomHash };
}

/** A repo-relative path: rejects absolute paths and any `..` escape (path traversal, CWE-22). */
function repoPath(params: Record<string, unknown>): string {
  const value = str(params, "path");
  if (value === "" || isAbsolute(value)) throw new RpcError(`"path" must be a repo-relative path.`);
  const normalized = normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new RpcError(`"path" must not escape the repository.`);
  }
  return value;
}

/** As repoPath, plus rejecting a leading "-" so the path can't be read as an editor flag (CWE-88). */
function editorPath(params: Record<string, unknown>): string {
  const value = repoPath(params);
  if (value.startsWith("-")) throw new RpcError(`"path" must not start with "-".`);
  return value;
}

function line(params: Record<string, unknown>): number {
  const value = params["line"];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RpcError(`"line" must be a positive integer.`);
  }
  return value;
}

function disposition(params: Record<string, unknown>): "done" | "skipped" {
  const value = params["disposition"];
  if (value === "done" || value === "skipped") return value;
  throw new RpcError(`"disposition" must be "done" or "skipped".`);
}

function side(params: Record<string, unknown>): "base" | "head" {
  const value = params["side"];
  if (value === "base" || value === "head") return value;
  throw new RpcError(`"side" must be "base" or "head".`);
}
