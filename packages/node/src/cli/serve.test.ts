// Regression: the browser must be opened WITH the `?context=` param — main.ts reads
// the review context from it; without it the UI hangs on "Loading review…" forever.

import { describe, expect, test } from "bun:test";
import type { ReviewContext } from "@cara/core";
import { appUrl } from "./serve.ts";

describe("appUrl", () => {
  test("appends the context query param main.ts reads", () => {
    expect(appUrl("http://127.0.0.1:51777", "main" as ReviewContext)).toBe(
      "http://127.0.0.1:51777?context=main",
    );
  });

  test("URL-encodes contexts with slashes (branch names)", () => {
    expect(appUrl("http://127.0.0.1:51777", "feat/x..main" as ReviewContext)).toBe(
      "http://127.0.0.1:51777?context=feat%2Fx..main",
    );
  });
});
