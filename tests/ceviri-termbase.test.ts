import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { columnIndex, parseTermbase } from "../lib/ceviri/termbase.ts";

function sheetXml(rows: string[][]): string {
  const letters = (i: number) => {
    let s = ""; let n = i;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  };
  const body = rows.map((cells, r) =>
    `<row r="${r + 1}">` +
    cells.map((v, c) => v === "" ? "" : `<c r="${letters(c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join("") +
    `</row>`).join("");
  return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

function buildXlsx(rows: string[][]): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook><sheets><sheet name="Sheet0" sheetId="1"/></sheets></workbook>`),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(rows)),
  });
}

const HEADER = ["Forbidden", "Domain", "Subdomain", "Definition",
  "en-US", "Notes", "Example of use",
  "tr-TR", "Notes", "Example of use"];

test("maps spreadsheet column refs to zero based indexes", () => {
  assert.equal(columnIndex("A1"), 0);
  assert.equal(columnIndex("Z9"), 25);
  assert.equal(columnIndex("AA3"), 26);
  assert.equal(columnIndex("AB12"), 27);
});

test("reads locales from the header row", () => {
  const { locales } = parseTermbase(buildXlsx([HEADER]));
  assert.deepEqual(locales, ["en-US", "tr-TR"]);
});

test("pairs each locale with its own term, notes and example", () => {
  const { rows } = parseTermbase(buildXlsx([
    HEADER,
    ["false", "Pharma", "Label", "a legal permit", "Registration", "capitalised", "See §3", "Ruhsat", "resmi", "Bkz. §3"],
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].forbidden, false);
  assert.equal(rows[0].domain, "Pharma");
  assert.equal(rows[0].definition, "a legal permit");
  assert.deepEqual(rows[0].entries, [
    { lang: "en-US", text: "Registration", notes: "capitalised", example: "See §3" },
    { lang: "tr-TR", text: "Ruhsat", notes: "resmi", example: "Bkz. §3" },
  ]);
});

test("treats the Forbidden column as a boolean", () => {
  const { rows } = parseTermbase(buildXlsx([
    HEADER,
    ["true", "", "", "", "cover pricing", "", "", "göstermelik teklif", "", ""],
  ]));
  assert.equal(rows[0].forbidden, true);
});

test("omits locales with no term on that row", () => {
  const { rows } = parseTermbase(buildXlsx([
    HEADER,
    ["false", "", "", "", "Molar Mass", "", "", "", "", ""],
  ]));
  assert.deepEqual(rows[0].entries, [{ lang: "en-US", text: "Molar Mass", notes: null, example: null }]);
});

test("drops rows that carry no term in any locale", () => {
  const { rows } = parseTermbase(buildXlsx([HEADER, ["false", "", "", "", "", "", "", "", "", ""]]));
  assert.deepEqual(rows, []);
});
