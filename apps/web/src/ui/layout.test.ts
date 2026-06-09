import { test } from "bun:test";
import assert from "node:assert/strict";
import { parseLayout } from "./layout.ts";

const DEFAULTS = { navWidth: 256, navCollapsed: false };

test("null (nothing persisted) yields defaults", () => {
  assert.deepEqual(parseLayout(null), DEFAULTS);
});

test("malformed JSON falls back to defaults", () => {
  assert.deepEqual(parseLayout("{not json"), DEFAULTS);
});

test("non-object JSON falls back to defaults", () => {
  assert.deepEqual(parseLayout("42"), DEFAULTS);
  assert.deepEqual(parseLayout("null"), DEFAULTS);
});

test("valid state round-trips", () => {
  const state = { navWidth: 300, navCollapsed: true };
  assert.deepEqual(parseLayout(JSON.stringify(state)), state);
});

test("width is clamped to its min/max", () => {
  const tooSmall = parseLayout(JSON.stringify({ navWidth: 10 }));
  assert.equal(tooSmall.navWidth, 180);
  const tooLarge = parseLayout(JSON.stringify({ navWidth: 9999 }));
  assert.equal(tooLarge.navWidth, 480);
});

test("non-finite or missing width falls back to default", () => {
  const result = parseLayout(JSON.stringify({ navWidth: "wide" }));
  assert.equal(result.navWidth, DEFAULTS.navWidth);
});

test("collapsed flag requires strict true", () => {
  const result = parseLayout(JSON.stringify({ navCollapsed: 1 }));
  assert.equal(result.navCollapsed, false);
});

test("stale chatWidth/chatCollapsed keys in storage are silently ignored", () => {
  // Old persisted state from pre-pivot 3-pane layout — must not crash or be included.
  const old = JSON.stringify({ navWidth: 300, chatWidth: 400, navCollapsed: false, chatCollapsed: false });
  const result = parseLayout(old);
  assert.deepEqual(result, { navWidth: 300, navCollapsed: false });
  assert.equal("chatWidth" in result, false);
  assert.equal("chatCollapsed" in result, false);
});
