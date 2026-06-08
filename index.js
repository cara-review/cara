#!/usr/bin/env bun
// The `clear-diff` bin. A thin bootstrap: the real CLI lives in the node package
// (typed, tested). Bun executes the imported .ts natively.
import { runCli, CliError } from "./packages/node/src/cli.ts";
import { UserFacingError } from "./packages/node/src/user-facing-error.ts";

runCli(process.argv.slice(2)).catch((error) => {
  const expected = error instanceof CliError || error instanceof UserFacingError;
  console.error(expected ? error.message : error);
  process.exitCode = 1;
});
