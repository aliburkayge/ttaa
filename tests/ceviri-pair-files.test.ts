import assert from "node:assert/strict";
import test from "node:test";
import { decodeZipName, pairReferenceFiles } from "../lib/ceviri/pair-files.ts";

test("pairs a scan with its translation by the shared name, whatever the language tag", () => {
  const { pairs, unmatched } = pairReferenceFiles([
    "arşiv/banka/eur-hesap-hareketleri.pdf",
    "arşiv/banka/eur-hesap-hareketleri_EN.docx",
    "arşiv/bordro/bordro.pdf",
    "arşiv/bordro/bordro-en.docx",
    "arşiv/adli sicil/Adli Sicil-Es.pdf",
    "arşiv/adli sicil/Adli Sicil-Es.docx",
    "arşiv/bordro/Earning certificado de retenciones 2025.pdf",
    "arşiv/bordro/Earning certificado de retenciones 2025 TR.docx",
  ]);
  assert.deepEqual(
    pairs.map((p) => [p.source, p.target]).sort(),
    [
      ["arşiv/adli sicil/Adli Sicil-Es.pdf", "arşiv/adli sicil/Adli Sicil-Es.docx"],
      ["arşiv/banka/eur-hesap-hareketleri.pdf", "arşiv/banka/eur-hesap-hareketleri_EN.docx"],
      ["arşiv/bordro/Earning certificado de retenciones 2025.pdf", "arşiv/bordro/Earning certificado de retenciones 2025 TR.docx"],
      ["arşiv/bordro/bordro.pdf", "arşiv/bordro/bordro-en.docx"],
    ].sort(),
  );
  assert.deepEqual(unmatched, []);
});

test("two Word files: the one with a language tag is the translation; copy counters are ignored", () => {
  const { pairs } = pairReferenceFiles(["cv/Olga's Resume (1) (1).docx", "cv/Olga's Resume (1) (1) (1)-rus.docx"]);
  assert.deepEqual(pairs, [{ source: "cv/Olga's Resume (1) (1).docx", target: "cv/Olga's Resume (1) (1) (1)-rus.docx" }]);
});

test("files in different folders never pair, and leftovers are reported", () => {
  const { pairs, unmatched } = pairReferenceFiles(["a/form.pdf", "b/form-TR.docx", "c/notes.txt"]);
  assert.deepEqual(pairs, []);
  assert.deepEqual(unmatched.sort(), ["a/form.pdf", "b/form-TR.docx", "c/notes.txt"]);
});

test("a translation named after part of the source's name pairs in a second pass", () => {
  const { pairs, unmatched } = pairReferenceFiles([
    "BASF/Formlar/ASPİRE 60 SL (BAS 555 00 F) AMBALAJ BİLGİ FORMU-EN.pdf",
    "BASF/Formlar/Aspire 60 SL.docx",
    "BASF/Formlar/DELAN SC (BASF 216 17 F) AMBALAJ BİLGİ FORMU-EN.pdf",
    "BASF/Formlar/Revycare ambalaj.docx",
  ]);
  assert.deepEqual(pairs, [
    { source: "BASF/Formlar/ASPİRE 60 SL (BAS 555 00 F) AMBALAJ BİLGİ FORMU-EN.pdf", target: "BASF/Formlar/Aspire 60 SL.docx" },
  ]);
  assert.deepEqual(unmatched.sort(), [
    "BASF/Formlar/DELAN SC (BASF 216 17 F) AMBALAJ BİLGİ FORMU-EN.pdf",
    "BASF/Formlar/Revycare ambalaj.docx",
  ]);
});

test("old Word (.doc) files are reported as unsupported, not silently dropped", () => {
  const { pairs, unsupported } = pairReferenceFiles(["n/Previcur 6036.pdf", "n/Previcur 6036 - TR.doc"]);
  assert.deepEqual(pairs, []);
  assert.deepEqual(unsupported, ["n/Previcur 6036 - TR.doc"]);
});

test("Turkish file names from a Windows zip (CP857 bytes) are decoded", () => {
  // Zip'te ad baytları olduğu gibi harfe çevrilmiş gelir: 0x9F ş, 0x87 ç, 0x8D ı, 0x94 ö, 0x81 ü, 0x98 İ, 0xA7 ğ, 0xA6 Ğ.
  const raw = (...parts: Array<string | number>) => parts.map((p) => (typeof p === "number" ? String.fromCharCode(p) : p)).join("");
  assert.equal(decodeZipName(raw("ar", 0x9f, "iv/a", 0x87, 0x8d, "k ", 0x94, 0x81, "retim/", 0x98, "ZM", 0x98, "R ", 0xa7, 0xa6, ".pdf")), "arşiv/açık öüretim/İZMİR ğĞ.pdf");
  assert.equal(decodeZipName("arşiv/açık.pdf"), "arşiv/açık.pdf", "already decoded names are left alone");
  assert.equal(decodeZipName("Résumé.docx"), "Résumé.docx", "Latin-1 accents without C1 bytes are left alone");
});
