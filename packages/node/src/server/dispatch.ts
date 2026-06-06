// RPC dispatch (ADR-0003): map a wire request onto the inbound ReviewService and
// the WorkspaceReader, returning a wire response. Pure of transport — no sockets,
// no JSON framing — so it unit-tests against fakes. Incoming messages are the
// untrusted boundary: parsed from `unknown`, validated, then dispatched.

import type { AtomHash, DiffSpec, ReviewService, WorkspaceReader } from "@clear-diff/core";
import { reviewContext } from "@clear-diff/core";
import type { ClientRequest, Method, ResultMap, ServerResponse } from "./protocol.ts";

/** The driving adapter's view of the backend: the inbound port + evidence reader + boot spec. */
export interface RpcDeps {
  readonly service: ReviewService;
  readonly workspace: WorkspaceReader;
  readonly spec: DiffSpec;
}

/** A malformed request. Surfaced to the client as `{ ok: false }`, never thrown past the seam. */
class RpcError extends Error {}

/** Validate and dispatch one request. Always resolves to a response — errors are data. */
export async function handleRequest(deps: RpcDeps, raw: unknown): Promise<ServerResponse> {
  const id = idOf(raw);
  try {
    const result = await dispatch(deps, parseRequest(raw));
    return { id, ok: true, result };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
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
      return {
        id,
        method,
        params: {
          context: reviewContext(str(params, "context")),
          atomHash: str(params, "atomHash") as AtomHash,
          disposition: disposition(params),
        },
      };
    case "unmark":
      return {
        id,
        method,
        params: { context: reviewContext(str(params, "context")), atomHash: str(params, "atomHash") as AtomHash },
      };
    case "comment":
      return {
        id,
        method,
        params: {
          context: reviewContext(str(params, "context")),
          atomHash: str(params, "atomHash") as AtomHash,
          body: str(params, "body"),
        },
      };
    case "openInEditor":
      return { id, method, params: { path: str(params, "path"), line: num(params, "line") } };
    case "readFile":
      return { id, method, params: { path: str(params, "path"), side: side(params) } };
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

function num(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RpcError(`"${key}" must be a number.`);
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
