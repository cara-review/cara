#!/usr/bin/env node
// The `clear-diff` bin. A thin bootstrap: the real CLI lives in the node package
// (typed, tested). Node strips types from the imported .ts at runtime.
import { runCli, CliError } from "./packages/node/src/cli.ts";

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof CliError ? error.message : error);
  process.exitCode = 1;
});
