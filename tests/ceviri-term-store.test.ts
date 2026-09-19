import assert from "node:assert/strict";
import test from "node:test";
import { toVariantInserts } from "../lib/ceviri/term-store.ts";
import type { TermRow } from "../lib/ceviri/termbase.ts";

function row(over: Partial<TermRow> = {}): TermRow {
  return {
    forbidden: false, domain: null, subdomain: null, definition: null,
    entries: [
      { lang: "en-US", text: "Registration", notes: null, example: null },
      { lang: "tr-TR", text: "Ruhsat", notes: "resmi", example: null },
    ],
    ...over,
  };
}

test("normalizes each variant in its own language", () => {
  const variants = toVariantInserts(row({
    entries: [{ lang: "tr-TR", text: "IŞIK", notes: null, example: null }],
  }));
  assert.equal(variants[0].normalized, "ışık");
});

test("normalizes English variants with English casing", () => {
  const variants = toVariantInserts(row({
    entries: [{ lang: "en-US", text: "ISO Standard", notes: null, example: null }],
  }));
  assert.equal(variants[0].normalized, "iso standard");
});

test("a normal row yields preferred, non forbidden variants", () => {
  const variants = toVariantInserts(row());
  assert.equal(variants.length, 2);
  assert.ok(variants.every((v) => v.is_preferred && !v.is_forbidden));
  assert.equal(variants[1].notes, "resmi");
});

test("a forbidden row yields forbidden, non preferred variants", () => {
  const variants = toVariantInserts(row({ forbidden: true }));
  assert.ok(variants.every((v) => v.is_forbidden && !v.is_preferred));
});
