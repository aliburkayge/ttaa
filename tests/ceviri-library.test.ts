import assert from "node:assert/strict";
import test from "node:test";
import { dateGroup, escapeLike, fileKind, parseLibraryQuery, toLibraryItem, whenLabel } from "../lib/ceviri/library.ts";

test("tells Word, PDF and images apart by file name", () => {
  assert.equal(fileKind("Letter FINAL signed.PDF"), "pdf");
  assert.equal(fileKind("Vekaletname.docx"), "word");
  assert.equal(fileKind("diploma_tarama.jpeg"), "image");
  assert.equal(fileKind("scan.tiff"), "image");
});

test("reads search, type and page from the address, with safe limits", () => {
  assert.deepEqual(parseLibraryQuery(new URLSearchParams("")), { q: "", kind: "all", offset: 0, limit: 30 });
  assert.deepEqual(parseLibraryQuery(new URLSearchParams("q=%20BASF%20&kind=pdf&offset=30&limit=5")), {
    q: "BASF",
    kind: "pdf",
    offset: 30,
    limit: 5,
  });
  assert.deepEqual(parseLibraryQuery(new URLSearchParams("kind=exe&offset=-4&limit=5000")), {
    q: "",
    kind: "all",
    offset: 0,
    limit: 60,
  });
});

test("a search for a percent sign or underscore finds it literally", () => {
  assert.equal(escapeLike("100%_done\\"), "100\\%\\_done\\\\");
});

test("a card knows its progress, page count and, for Word, its first lines", () => {
  const item = toLibraryItem({
    id: "d1",
    filename: "Vekaletname.docx",
    created_at: "2026-09-22T10:00:00Z",
    source_lang: "tr-TR",
    target_lang: "de-DE",
    stats: { pages: 2 },
    segments: [
      { text: "VEKALETNAME", translation: "VOLLMACHT" },
      { text: "Ben aşağıda imzası bulunan…", translation: null },
      { text: "Ahmet Yılmaz", translation: null },
      { text: "Dördüncü satır", translation: null },
    ],
  });
  assert.equal(item.kind, "word");
  assert.equal(item.total, 4);
  assert.equal(item.translated, 1);
  assert.equal(item.pages, 2);
  assert.deepEqual(item.preview, ["VEKALETNAME", "Ben aşağıda imzası bulunan…", "Ahmet Yılmaz"]);
  const scan = toLibraryItem({ ...item, filename: "scan.pdf", stats: null, segments: [] });
  assert.deepEqual(scan.preview, []);
  assert.equal(scan.pages, null);
});

test("groups documents by when they were made", () => {
  const now = new Date(2026, 8, 22, 15, 0); // Tuesday 22 September
  assert.equal(dateGroup(new Date(2026, 8, 22, 9, 0).toISOString(), now), "Bugün");
  assert.equal(dateGroup(new Date(2026, 8, 21, 23, 0).toISOString(), now), "Dün");
  assert.equal(dateGroup(new Date(2026, 8, 17, 12, 0).toISOString(), now), "Bu hafta");
  assert.equal(dateGroup(new Date(2026, 8, 2, 12, 0).toISOString(), now), "Bu ay");
  assert.equal(dateGroup(new Date(2026, 5, 2, 12, 0).toISOString(), now), "Daha eski");
});

test("a card says when, the way people say it", () => {
  const now = new Date(2026, 8, 22, 15, 0); // Tuesday
  assert.equal(whenLabel(new Date(2026, 8, 22, 13, 52).toISOString(), now), "13:52");
  assert.equal(whenLabel(new Date(2026, 8, 21, 18, 20).toISOString(), now), "Dün 18:20");
  assert.equal(whenLabel(new Date(2026, 8, 17, 10, 5).toISOString(), now), "Per 10:05");
  assert.equal(whenLabel(new Date(2026, 8, 2, 10, 5).toISOString(), now), "2 Eyl");
  assert.equal(whenLabel(new Date(2025, 11, 30, 10, 5).toISOString(), now), "30 Ara 2025");
});
