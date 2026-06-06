import { test } from "node:test";
import assert from "node:assert/strict";
import { keyToAction } from "./keyboard.ts";

test("keyToAction maps j/k and arrows to Section navigation", () => {
  assert.equal(keyToAction("j"), "next");
  assert.equal(keyToAction("ArrowDown"), "next");
  assert.equal(keyToAction("k"), "prev");
  assert.equal(keyToAction("ArrowUp"), "prev");
});

test("keyToAction maps done/skip in either case", () => {
  assert.equal(keyToAction("d"), "done");
  assert.equal(keyToAction("D"), "done");
  assert.equal(keyToAction("s"), "skip");
  assert.equal(keyToAction("S"), "skip");
});

test("keyToAction returns null for unbound keys", () => {
  for (const key of ["a", "Enter", "ArrowLeft", " ", "1"]) {
    assert.equal(keyToAction(key), null);
  }
});
