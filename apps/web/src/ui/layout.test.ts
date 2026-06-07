import { test } from "bun:test";
import assert from "node:assert/strict";
import { parseLayout } from "./layout.ts";

const DEFAULTS = { navWidth: 256, chatWidth: 320, navCollapsed: false, chatCollapsed: false };

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
  const state = { navWidth: 300, chatWidth: 400, navCollapsed: true, chatCollapsed: false };
  assert.deepEqual(parseLayout(JSON.stringify(state)), state);
});

test("widths are clamped to their min/max", () => {
  const tooSmall = parseLayout(JSON.stringify({ navWidth: 10, chatWidth: 10 }));
  assert.equal(tooSmall.navWidth, 180);
  assert.equal(tooSmall.chatWidth, 240);
  const tooLarge = parseLayout(JSON.stringify({ navWidth: 9999, chatWidth: 9999 }));
  assert.equal(tooLarge.navWidth, 480);
  assert.equal(tooLarge.chatWidth, 520);
});

test("non-finite or missing widths fall back to defaults", () => {
  const result = parseLayout(JSON.stringify({ navWidth: "wide", chatWidth: null }));
  assert.equal(result.navWidth, DEFAULTS.navWidth);
  assert.equal(result.chatWidth, DEFAULTS.chatWidth);
});

test("collapsed flags require strict true", () => {
  const result = parseLayout(JSON.stringify({ navCollapsed: 1, chatCollapsed: "yes" }));
  assert.equal(result.navCollapsed, false);
  assert.equal(result.chatCollapsed, false);
});
