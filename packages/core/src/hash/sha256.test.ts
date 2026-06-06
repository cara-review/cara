import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "./sha256.ts";

test("empty string vector", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("'abc' vector", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("multi-block vector (>55 bytes forces two blocks)", () => {
  assert.equal(
    sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("multi-byte UTF-8 vector", () => {
  // "é" (U+00E9) encodes to bytes 0xC3 0xA9; pinned against the canonical digest.
  assert.equal(sha256Hex("é"), "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
});
