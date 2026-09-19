import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { encodeXml, parseDocx, rebuildDocx } from "../lib/ceviri/docx.ts";

/** Builds a minimal but structurally real .docx around the given body XML. */
function docx(body: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`,
    ),
    ...extra,
  });
}

const run = (text: string, props = "") => `<w:r>${props}<w:t>${text}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;

test("reads one segment per paragraph", () => {
  const doc = parseDocx(docx(para(run("Trade name")) + para(run("Formulation"))));
  assert.deepEqual(doc.segments.map((s) => s.text), ["Trade name", "Formulation"]);
});

test("joins runs that Word split mid-sentence into one segment", () => {
  // Word splits a sentence whenever formatting changes; the segment is the whole line.
  const body = para(run("Trade "), run("name", "<w:rPr><w:b/></w:rPr>"), run(" of product"));
  const doc = parseDocx(docx(body));
  assert.equal(doc.segments.length, 1);
  assert.equal(doc.segments[0].text, "Trade name of product");
});

test("decodes XML entities in the source text", () => {
  const doc = parseDocx(docx(para(run("Ticari ad&#305; &amp; kod &lt;x&gt;"))));
  assert.equal(doc.segments[0].text, "Ticari adı & kod <x>");
});

test("skips paragraphs that hold no text", () => {
  const doc = parseDocx(docx(para(run("   ")) + para() + para(run("Real"))));
  assert.deepEqual(doc.segments.map((s) => s.text), ["Real"]);
});

test("marks paragraphs inside a table as table cells", () => {
  const body =
    para(run("Heading")) +
    `<w:tbl><w:tr><w:tc>${para(run("Cell A"))}</w:tc><w:tc>${para(run("Cell B"))}</w:tc></w:tr></w:tbl>` +
    para(run("Footer"));
  const doc = parseDocx(docx(body));
  assert.deepEqual(
    doc.segments.map((s) => [s.text, s.kind]),
    [["Heading", "paragraph"], ["Cell A", "table-cell"], ["Cell B", "table-cell"], ["Footer", "paragraph"]],
  );
  assert.equal(doc.stats.tables, 1);
  assert.equal(doc.stats.tableCells, 2);
  assert.equal(doc.stats.paragraphs, 2);
});

test("counts embedded media as preserved images", () => {
  const doc = parseDocx(
    docx(para(run("x")), { "word/media/image1.png": strToU8("binary") }),
  );
  assert.equal(doc.stats.images, 1);
});

test("rejects a zip that is not a Word document", () => {
  const notWord = zipSync({ "hello.txt": strToU8("hi") });
  assert.throws(() => parseDocx(notWord), /Word belgesi/);
});

test("writes translations back and leaves the segment count unchanged", () => {
  const source = docx(para(run("One")) + para(run("Two")));
  const rebuilt = rebuildDocx(source, new Map([["p1", "Bir"], ["p2", "İki"]]));
  assert.deepEqual(parseDocx(rebuilt).segments.map((s) => s.text), ["Bir", "İki"]);
});

test("keeps run formatting when a split sentence is replaced", () => {
  const body = para(run("Trade "), run("name", "<w:rPr><w:b/></w:rPr>"));
  const rebuilt = rebuildDocx(docx(body), new Map([["p1", "Ticari ad"]]));
  const xml = strFromU8(unzipSync(rebuilt)["word/document.xml"]);
  // The bold run property survives even though its text was emptied.
  assert.match(xml, /<w:b\/>/);
  assert.equal(parseDocx(rebuilt).segments[0].text, "Ticari ad");
});

test("leaves untranslated paragraphs exactly as they were", () => {
  const source = docx(para(run("Keep me")) + para(run("Change me")));
  const rebuilt = rebuildDocx(source, new Map([["p2", "Değiştim"]]));
  assert.deepEqual(parseDocx(rebuilt).segments.map((s) => s.text), ["Keep me", "Değiştim"]);
});

test("preserves tables, images and their counts through a round trip", () => {
  const body =
    para(run("Title")) +
    `<w:tbl><w:tr><w:tc>${para(run("Cell"))}</w:tc></w:tr></w:tbl>`;
  const source = docx(body, { "word/media/logo.png": strToU8("png") });
  const before = parseDocx(source);
  const rebuilt = rebuildDocx(
    source,
    new Map(before.segments.map((segment) => [segment.id, `çeviri:${segment.text}`])),
  );
  const after = parseDocx(rebuilt);
  assert.deepEqual(after.stats, before.stats);
  assert.equal(after.segments.length, before.segments.length);
  assert.ok(after.segments.every((segment) => segment.text.startsWith("çeviri:")));
  assert.ok(unzipSync(rebuilt)["word/media/logo.png"], "gömülü görsel kayboldu");
});

test("escapes characters that would otherwise break the document XML", () => {
  assert.equal(encodeXml('a & b < c > d'), "a &amp; b &lt; c &gt; d");
  const rebuilt = rebuildDocx(docx(para(run("x"))), new Map([["p1", "Ar-Ge & <test>"]]));
  assert.equal(parseDocx(rebuilt).segments[0].text, "Ar-Ge & <test>");
});

test("keeps leading and trailing spaces in a translation", () => {
  const rebuilt = rebuildDocx(docx(para(run("x"))), new Map([["p1", "  boşluklu  "]]));
  const xml = strFromU8(unzipSync(rebuilt)["word/document.xml"]);
  assert.match(xml, /xml:space="preserve"/);
});
