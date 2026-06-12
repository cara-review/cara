// Server discovery (ADR-0011). `present` boots a detached, long-lived server for
// the human's browser; a later `dispatch --wait` in a fresh process must find it to
// observe live activity. The boot writes `<stateDir>/<contextHash>.server.json`; the
// server deletes it on close. A missing file, or a file whose pid is dead, means there
// is nothing to wait on — `dispatch --wait` then settles from the store immediately.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewContext } from "@cara/core";
import { contextHash } from "../context-hash.ts";

export interface ServerInfo {
  readonly url: string;
  readonly pid: number;
  readonly ts: number;
}

function discoveryPath(stateDir: string, context: ReviewContext): string {
  return join(stateDir, `${contextHash(context)}.server.json`);
}

/** Where `present` persists the raw inbound grouping for the detached server to read. */
export function groupingPath(stateDir: string, context: ReviewContext): string {
  return join(stateDir, `${contextHash(context)}.grouping.json`);
}

export async function writeDiscovery(stateDir: string, context: ReviewContext, info: ServerInfo): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(discoveryPath(stateDir, context), JSON.stringify(info), "utf8");
}

export async function removeDiscovery(stateDir: string, context: ReviewContext): Promise<void> {
  await rm(discoveryPath(stateDir, context), { force: true });
}

/** Read the discovery record, or null when absent or unparseable. */
export async function readDiscovery(stateDir: string, context: ReviewContext): Promise<ServerInfo | null> {
  let raw: string;
  try {
    raw = await readFile(discoveryPath(stateDir, context), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ServerInfo;
    // A positive integer pid only: `isAlive` feeds this to `process.kill(pid, 0)`, where
    // pid 0 / negatives address a *process group* (POSIX). A corrupt record is treated as
    // no server, not a group probe.
    if (typeof parsed.url === "string" && Number.isInteger(parsed.pid) && parsed.pid > 0) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** True when a process with `pid` is alive (signal 0 probes without delivering). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
