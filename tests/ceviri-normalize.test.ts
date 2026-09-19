import assert from "node:assert/strict";
import test from "node:test";
import { localeLower, normalizeForMatch, segmentHash } from "../lib/ceviri/normalize.ts";

test("lowercases Turkish dotted and dotless I correctly", () => {
  assert.equal(localeLower("İMZA", "tr-TR"), "imza");
  assert.equal(localeLower("IŞIK", "tr-TR"), "ışık");
  assert.equal(localeLower("MÜHÜR", "tr"), "mühür");
});

test("does not apply Turkish casing to non-Turkish text", () => {
  assert.equal(localeLower("I AGREE", "en-US"), "i agree");
  assert.equal(localeLower("REGISTRATION", "en-GB"), "registration");
});

test("collapses whitespace and trims", () => {
  assert.equal(normalizeForMatch("  Delan®   SC \n (BAS 216 17 F) ", "en-US"), "delan® sc (bas 216 17 f)");
});

test("hash is stable across whitespace and case differences", () => {
  assert.equal(segmentHash("Trade  NAME", "en-US"), segmentHash("trade name", "en-US"));
});

test("hash differs between languages for the dotless I", () => {
  assert.notEqual(segmentHash("ISIK", "tr-TR"), segmentHash("ISIK", "en-US"));
});

test("hash is a 64 character hex string", () => {
  assert.match(segmentHash("anything", "en-US"), /^[0-9a-f]{64}$/);
});
