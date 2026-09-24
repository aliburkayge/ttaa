import assert from "node:assert/strict";
import test from "node:test";
import { looksPersonal, meaningful } from "../lib/ceviri/reference-import.ts";

test("paragraphs with no real text never enter the alignment", () => {
  // Gerçek BASF çevirisinde "." paragrafları vardı; "CONTROL → ." diye eşleniyordu.
  assert.equal(meaningful("."), false);
  assert.equal(meaningful("1."), false);
  assert.equal(meaningful("— –"), false);
  assert.equal(meaningful("CONTROL"), true);
  assert.equal(meaningful("İsviçre"), true);
});

test("names, addresses and ID numbers are kept out of the memory, translated terms are not", () => {
  assert.equal(looksPersonal({ source: "Lukas Moravec", target: "Lukas Moravec" }), true, "a name stays the same in translation");
  assert.equal(looksPersonal({ source: "Huobstrasse 3", target: "Huobstrasse 3" }), true);
  assert.equal(looksPersonal({ source: "T.C. Kimlik No: 12345678901", target: "ID No: 12345678901" }), true);
  assert.equal(looksPersonal({ source: "Switzerland", target: "İsviçre" }), false);
  assert.equal(looksPersonal({ source: "Postal Address", target: "Posta adresi" }), false);
  assert.equal(looksPersonal({ source: "PRIVEST SC REGISTRATION NUMBER : 11710", target: "PRIVEST SC RUHSAT NUMARASI: 11710" }), false);
});
