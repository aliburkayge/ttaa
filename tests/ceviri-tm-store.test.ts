import assert from "node:assert/strict";
import test from "node:test";
import { dedupeRows, toTmRow } from "../lib/ceviri/tm-store.ts";
import type { TmxUnit } from "../lib/ceviri/tmx.ts";

function unit(over: Partial<TmxUnit> = {}): TmxUnit {
  return {
    sourceLang: "en-US", targetLang: "tr-TR",
    sourceText: "Trade name", targetText: "Ticari adı",
    projectName: "basf 11-08", contextPre: null, contextPost: null, origin: "TM",
    ...over,
  };
}

test("builds a row with hashes and a normalized source", () => {
  const row = toTmRow(unit())!;
  assert.equal(row.source_normalized, "trade name");
  assert.match(row.source_hash, /^[0-9a-f]{64}$/);
  assert.match(row.target_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(row.project_names, ["basf 11-08"]);
  assert.equal(row.origin, "tmx-import");
});

test("rejects units with an empty side", () => {
  assert.equal(toTmRow(unit({ sourceText: "   " })), null);
  assert.equal(toTmRow(unit({ targetText: "" })), null);
});

test("uses an empty project list when the TMX has no project name", () => {
  assert.deepEqual(toTmRow(unit({ projectName: null }))!.project_names, []);
});

test("collapses duplicates that differ only by case or spacing", () => {
  const rows = dedupeRows([
    toTmRow(unit())!,
    toTmRow(unit({ sourceText: "TRADE   NAME" }))!,
  ]);
  assert.equal(rows.length, 1);
});

test("merges project tags of collapsed duplicates without repeating them", () => {
  const rows = dedupeRows([
    toTmRow(unit({ projectName: "basf 11-08" }))!,
    toTmRow(unit({ projectName: "basf 08-06" }))!,
    toTmRow(unit({ projectName: "basf 11-08" }))!,
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual([...rows[0].project_names].sort(), ["basf 08-06", "basf 11-08"]);
});

test("keeps rows apart when the target text differs", () => {
  const rows = dedupeRows([
    toTmRow(unit())!,
    toTmRow(unit({ targetText: "Ticaret unvanı" }))!,
  ]);
  assert.equal(rows.length, 2);
});

test("keeps rows apart when the language pair differs", () => {
  const rows = dedupeRows([
    toTmRow(unit())!,
    toTmRow(unit({ targetLang: "de-DE", targetText: "Handelsname" }))!,
  ]);
  assert.equal(rows.length, 2);
});

// upsert_tm_segments (202609190004_upsert_tm_segments.sql) does
// ON CONFLICT (source_lang, target_lang, source_hash, target_hash) DO UPDATE,
// which Postgres refuses with "cannot affect row a second time" if a single
// statement carries two rows under the same conflict key. dedupeRows is what
// guarantees that never happens, for any input — not just the handful of
// cases above — so it is covered here as its own invariant.
test("dedupeRows never returns two rows sharing a (lang pair, hashes) key", () => {
  const rows = dedupeRows([
    toTmRow(unit({ projectName: "a" }))!,
    toTmRow(unit({ projectName: "b" }))!,
    toTmRow(unit({ sourceText: "  trade name  ", projectName: "c" }))!,
    toTmRow(unit({ targetText: "Ticaret unvanı", projectName: "d" }))!,
    toTmRow(unit({ targetText: "Ticaret unvanı", projectName: "e" }))!,
    toTmRow(unit({ targetLang: "de-DE", targetText: "Handelsname", projectName: "f" }))!,
  ]);

  const keys = rows.map((r) => [r.source_lang, r.target_lang, r.source_hash, r.target_hash].join("\u0000"));
  assert.equal(new Set(keys).size, keys.length);
  // Three distinct segments in the input above: the base text, the "Ticaret
  // unvanı" target variant, and the de-DE pair.
  assert.equal(rows.length, 3);
});
