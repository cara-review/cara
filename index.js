#!/usr/bin/env bun
// The `clear-diff` bin. A thin bootstrap: the real CLI lives in the node package
// (typed, tested). Bun executes the imported .ts natively.
import { runCli, CliError } from "./packages/node/src/cli.ts";

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof CliError ? error.message : error);
  process.exitCode = 1;
});
