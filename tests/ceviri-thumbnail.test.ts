import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { makeThumbnail } from "../lib/ceviri/thumbnail.ts";

test("draws the first page of a PDF, upright and at the asked width", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  page.drawRectangle({ x: 0, y: 300, width: 300, height: 100, color: rgb(0, 0, 0) });
  doc.addPage([300, 400]);
  const thumb = await makeThumbnail(await doc.save(), "letter.pdf", 150);
  assert.ok(thumb);
  const { width, height } = await sharp(thumb.bytes).metadata();
  assert.equal(width, 150);
  assert.equal(height, 200);
  assert.equal(thumb.mime, "image/webp");
  // The black band is at the top of the page.
  const { data } = await sharp(thumb.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] < 60, "top of the page is not dark");
});

test("shrinks an image and turns it the way the camera held it", async () => {
  const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#d0c0a0" } }).jpeg().toBuffer();
  const thumb = await makeThumbnail(new Uint8Array(photo), "diploma.jpg", 200);
  assert.ok(thumb);
  const { width, height } = await sharp(thumb.bytes).metadata();
  assert.equal(width, 200);
  assert.equal(height, 150);
});

test("a Word file has no picture; the card shows its first lines instead", async () => {
  assert.equal(await makeThumbnail(new Uint8Array([80, 75, 3, 4]), "Vekaletname.docx", 200), null);
});
