import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { buildDocxFromLayout } from "../lib/ceviri/docx-build.ts";
import { parseImageKind } from "../lib/ceviri/image-kind.ts";
import {
  imageKey,
  layoutFromMistral,
  layoutSegments,
  layoutStats,
  parseTableHtml,
  placeholderFor,
  textLines,
  type ImageInsight,
  type MistralResponse,
} from "../lib/ceviri/ocr-layout.ts";

/**
 * Same shape as a real Mistral OCR 4 response for a two-page scanned
 * packaging form (block types, table HTML, image refs, confidence fields),
 * with invented content so no customer document lives in the repository.
 */
function conf(min: number, avg = min) {
  return { minimum_content_confidence_score: min, average_content_confidence_score: avg };
}

const TINY_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const RESPONSE: MistralResponse = {
  model: "mistral-ocr-latest",
  pages: [
    {
      index: 0,
      dimensions: { dpi: 87, width: 720, height: 1018 },
      images: [{ id: "img-0.jpeg", top_left_x: 60, top_left_y: 40, bottom_right_x: 220, bottom_right_y: 90, image_base64: TINY_JPEG }],
      blocks: [
        { type: "image", content: "![img-0.jpeg](img-0.jpeg)", confidence_scores: null },
        { type: "text", content: "ACME Agro B.V., 8808 Sampletown", confidence_scores: conf(0.62, 0.95) },
        { type: "caption", content: "PACKAGING INFORMATION FORM", confidence_scores: conf(1) },
        {
          type: "table",
          content:
            "<table><tr><td>1. Trade name</td><td>Examplo® SC (ABC 123 45 F)</td></tr>" +
            "<tr><td>6. Packaging weight</td><td>0.25 L: 30 g bottle<br/>5 L: 160 g bottle &amp; handle</td></tr>" +
            "<tr><td colspan=\"2\">12. Packaging image</td></tr></table>",
          confidence_scores: conf(0.92, 0.99),
        },
        { type: "footer", content: "Page 1 of 2", confidence_scores: conf(1) },
      ],
    },
    {
      index: 1,
      dimensions: { dpi: 87, width: 720, height: 1018 },
      images: [
        { id: "img-0.jpeg", top_left_x: 53, top_left_y: 632, bottom_right_x: 190, bottom_right_y: 675, image_base64: TINY_JPEG },
        { id: "img-1.jpeg", top_left_x: 258, top_left_y: 644, bottom_right_x: 567, bottom_right_y: 785, image_base64: TINY_JPEG },
      ],
      // Real reading order and coordinates from the scanned original: two
      // signatories side by side, and OCR lists both images before the
      // left-hand name.
      blocks: [
        { type: "title", content: "# ACME AGRO B.V.", confidence_scores: conf(0.95), top_left_x: 53, top_left_y: 617, bottom_right_x: 400, bottom_right_y: 632 },
        { type: "image", content: "![img-0.jpeg](img-0.jpeg)", confidence_scores: null },
        { type: "image", content: "![img-1.jpeg](img-1.jpeg)", confidence_scores: null },
        { type: "text", content: "Jane Example", confidence_scores: conf(1), top_left_x: 53, top_left_y: 677, bottom_right_x: 127, bottom_right_y: 690 },
        { type: "text", content: "Postal Address", confidence_scores: conf(1), top_left_x: 270, top_left_y: 814, bottom_right_x: 333, bottom_right_y: 824 },
      ],
    },
  ],
};

const INSIGHTS = new Map<string, ImageInsight>([
  [imageKey(0, "img-0.jpeg"), { kind: "logo", lines: [] }],
  // A bare signature: second-pass OCR "read" a name out of the scribble.
  [imageKey(1, "img-0.jpeg"), { kind: "signature", lines: [{ text: "Schulz", confidence: 0.49 }] }],
  // Stamp + signature with a printed name beside it, missed by the first pass.
  [
    imageKey(1, "img-1.jpeg"),
    { kind: "signature_stamp", lines: [{ text: "John Sample\nHead of Supply", confidence: 0.89 }] },
  ],
]);

test("splits a table cell on line breaks and decodes entities", () => {
  const rows = parseTableHtml(
    '<table><tr><td>a</td><td>x<br/>y &amp; z</td></tr><tr><td colspan="2">wide</td></tr></table>',
  );
  assert.deepEqual(rows, [
    [{ colspan: 1, lines: ["a"] }, { colspan: 1, lines: ["x", "y & z"] }],
    [{ colspan: 2, lines: ["wide"] }],
  ]);
});

test("keeps an empty cell so a table continued from the previous page stays aligned", () => {
  const rows = parseTableHtml("<table><tr><td></td><td>is considered stable.</td></tr></table>");
  assert.deepEqual(rows[0][0], { colspan: 1, lines: [] });
});

test("strips markdown heading marks from OCR text", () => {
  assert.deepEqual(textLines("# ACME AGRO B.V.\n\n  Second   line "), ["ACME AGRO B.V.", "Second line"]);
});

test("builds page-ordered blocks from a Mistral response", () => {
  const blocks = layoutFromMistral(RESPONSE, INSIGHTS);
  assert.deepEqual(
    blocks.map((block) => `${block.page}:${block.kind}${block.kind === "paragraph" ? `/${block.role}` : ""}`),
    [
      "1:image", "1:paragraph/text", "1:paragraph/title", "1:table", "1:paragraph/footer",
      "2:paragraph/title", "2:image", "2:image", "2:paragraph/text", "2:paragraph/text",
    ],
  );
});

test("keeps a signature next to the name printed under it", () => {
  // OCR order: signature (left), stamp block (right), name (left). Written
  // in that order, the left signature lands above the other signatory.
  const blocks = layoutFromMistral(RESPONSE, INSIGHTS).filter((block) => block.page === 2);
  const order = blocks.map((block) =>
    block.kind === "image" ? `[${block.image}]` : block.kind === "paragraph" ? block.lines[0].text : "table",
  );
  assert.deepEqual(order, [
    "ACME AGRO B.V.",
    "[signature_stamp]",
    "[signature]",
    "Jane Example",
    "Postal Address",
  ]);
});

test("does not pull a stamp onto a line that is too far below it to be its name", () => {
  const blocks = layoutFromMistral(RESPONSE, INSIGHTS).filter((block) => block.page === 2);
  const stamp = blocks.findIndex((block) => block.kind === "image" && block.image === "signature_stamp");
  const postal = blocks.findIndex((block) => block.kind === "paragraph" && block.lines[0].text === "Postal Address");
  assert.notEqual(postal, stamp + 1);
});

test("flags a line the OCR was unsure of, and leaves confident lines alone", () => {
  const segments = layoutSegments(layoutFromMistral(RESPONSE, INSIGHTS));
  const address = segments.find((segment) => segment.text.startsWith("ACME Agro"));
  assert.match(String(address?.ocrWarning), /en düşük güven %62/);
  const title = segments.find((segment) => segment.text === "PACKAGING INFORMATION FORM");
  assert.equal(title?.ocrWarning, null);
});

test("recovers printed text hidden inside a stamp image", () => {
  const segments = layoutSegments(layoutFromMistral(RESPONSE, INSIGHTS));
  const name = segments.find((segment) => segment.text === "John Sample");
  assert.ok(name, "stamp-embedded signatory is missing");
  assert.match(String(name.ocrWarning), /görselin/);
  assert.ok(segments.some((segment) => segment.text === "Head of Supply"));
});

test("never turns a signature scribble into a name", () => {
  const segments = layoutSegments(layoutFromMistral(RESPONSE, INSIGHTS));
  assert.equal(segments.some((segment) => segment.text === "Schulz"), false);
});

test("keeps logo pixels but drops signature and stamp pixels", () => {
  const images = layoutFromMistral(RESPONSE, INSIGHTS).filter((block) => block.kind === "image");
  assert.deepEqual(
    images.map((block) => [block.kind === "image" && block.image, block.kind === "image" && block.data !== null]),
    [["logo", true], ["signature_stamp", false], ["signature", false]],
  );
});

test("treats an image it could not classify as something to keep, not delete", () => {
  const blocks = layoutFromMistral(RESPONSE, new Map());
  const images = blocks.filter((block) => block.kind === "image");
  assert.ok(images.every((block) => block.kind === "image" && block.image === "unknown" && block.data));
});

test("counts pages, tables, cells and words for the UI", () => {
  const stats = layoutStats(layoutFromMistral(RESPONSE, INSIGHTS), 2);
  assert.equal(stats.pages, 2);
  assert.equal(stats.tables, 1);
  assert.equal(stats.tableCells, 6);
  assert.equal(stats.images, 3);
  assert.ok(stats.words > 10);
});

test("writes placeholders in the target language", () => {
  assert.equal(placeholderFor("signature", "tr-TR"), "[İMZA]");
  assert.equal(placeholderFor("signature_stamp", "tr-TR"), "[İMZA] [MÜHÜR]");
  assert.equal(placeholderFor("stamp", "en-US"), "[STAMP]");
  assert.equal(placeholderFor("logo", "tr-TR"), null);
});

test("reads the image classifier's label and refuses anything off the list", () => {
  assert.equal(parseImageKind('{"kind": "signature_stamp"}'), "signature_stamp");
  assert.equal(parseImageKind('```json\n{"kind":"logo"}\n```'), "logo");
  assert.equal(parseImageKind('{"kind": "handwriting"}'), "unknown");
  assert.equal(parseImageKind("I think it is a stamp"), "unknown");
});

function built(translations: Map<string, string>) {
  const blocks = layoutFromMistral(RESPONSE, INSIGHTS);
  const files = unzipSync(buildDocxFromLayout(blocks, translations, "tr-TR"));
  return { blocks, files, xml: strFromU8(files["word/document.xml"]) };
}

test("produces a Word package with the parts Word requires", () => {
  const { files } = built(new Map());
  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"]) {
    assert.ok(files[part], `${part} eksik`);
  }
});

test("writes translations, and the source where a line is untranslated", () => {
  const blocks = layoutFromMistral(RESPONSE, INSIGHTS);
  const title = layoutSegments(blocks).find((segment) => segment.text === "PACKAGING INFORMATION FORM")!;
  const { xml } = built(new Map([[title.id, "AMBALAJ BİLGİ FORMU"]]));
  assert.match(xml, /AMBALAJ BİLGİ FORMU/);
  assert.equal(xml.includes("PACKAGING INFORMATION FORM"), false);
  assert.match(xml, /Page 1 of 2/, "untranslated line vanished instead of falling back to the source");
});

test("escapes XML special characters", () => {
  const { xml } = built(new Map());
  assert.match(xml, /160 g bottle &amp; handle/);
});

test("keeps the table: cell line breaks, spanning cells and borders", () => {
  const { xml } = built(new Map());
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1);
  assert.match(xml, /0\.25 L: 30 g bottle<\/w:t><\/w:r><w:r><w:br\/><\/w:r>/);
  assert.match(xml, /<w:gridSpan w:val="2"\/>/);
  assert.match(xml, /<w:tblBorders>/);
});

test("breaks the page where the source page ended", () => {
  const { xml } = built(new Map());
  assert.equal((xml.match(/<w:br w:type="page"\/>/g) ?? []).length, 1);
});

test("embeds the logo and writes placeholders for signature and stamp", () => {
  const { files, xml } = built(new Map());
  const media = Object.keys(files).filter((name) => name.startsWith("word/media/"));
  assert.deepEqual(media, ["word/media/image1.jpeg"]);
  assert.match(xml, /r:embed="rIdImg1"/);
  assert.match(xml, /\[İMZA\]<\/w:t>/);
  assert.match(xml, /\[İMZA\] \[MÜHÜR\]<\/w:t>/);
  assert.match(strFromU8(files["word/_rels/document.xml.rels"]), /Target="media\/image1\.jpeg"/);
});

test("prints the signatory recovered from inside the stamp under its placeholder", () => {
  const { xml } = built(new Map());
  assert.ok(xml.indexOf("[İMZA] [MÜHÜR]") < xml.indexOf("John Sample"));
});
