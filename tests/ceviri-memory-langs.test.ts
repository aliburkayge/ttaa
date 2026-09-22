import assert from "node:assert/strict";
import test from "node:test";
import { memoryPairs, mergeMatches, type TmMatch } from "../lib/ceviri/tm-store.ts";

const match = (id: string, score: number): TmMatch => ({
  id,
  source_text: id,
  target_text: id,
  score,
  origin: "tmx",
  quality: "approved",
  project_names: [],
});

test("an English variant looks in its own memory first, then the shared English ones", () => {
  assert.deepEqual(memoryPairs("en-AU", "tr-TR"), [
    ["en-AU", "tr-TR"],
    ["en-US", "tr-TR"],
    ["en-GB", "tr-TR"],
  ]);
  assert.deepEqual(memoryPairs("tr-TR", "en-GB"), [
    ["tr-TR", "en-GB"],
    ["tr-TR", "en-US"],
  ]);
  assert.deepEqual(memoryPairs("de-DE", "tr-TR"), [["de-DE", "tr-TR"]]);
});

test("merged matches keep the best score; on a tie the document's own variant wins", () => {
  const merged = mergeMatches(
    [
      [match("a", 0.9), match("b", 1)],
      [match("c", 1), match("a", 0.95)],
    ],
    3,
  );
  assert.deepEqual(
    merged.map((m) => [m.id, m.score]),
    [
      ["b", 1],
      ["c", 1],
      ["a", 0.95],
    ],
  );
  assert.equal(mergeMatches([[match("a", 0.8)], [match("b", 0.9)]], 1)[0].id, "b");
});
