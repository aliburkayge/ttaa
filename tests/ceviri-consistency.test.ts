import assert from "node:assert/strict";
import test from "node:test";
import { harmonize, reviewDocument, unifyRepeats } from "../lib/ceviri/consistency.ts";

type Seg = { id: string; text: string; translation: string | null; source: string | null };
const seg = (id: string, text: string, translation: string, source = "engine"): Seg => ({ id, text, translation, source });

test("the same source sentence gets the same translation everywhere", () => {
  const changes = unifyRepeats([
    seg("a", "Sincerely,", "Saygılarımla,", "tm-exact"),
    seg("b", "Sincerely,", "Saygılarımızla,"),
    seg("c", "Sincerely,  ", "Saygılar,"),
    seg("u", "SINCERELY,", "SAYGILARIMLA,"),
    seg("d", "Dear Sir", "Sayın Yetkili"),
  ]);
  assert.deepEqual(
    changes.map(({ id, translation }) => [id, translation]),
    [
      ["b", "Saygılarımla,"],
      ["c", "Saygılarımla,"],
    ],
  );
});

test("keeps a line written in capitals apart from the same words in normal case", () => {
  const changes = unifyRepeats([seg("a", "2 TW Alexander Drive", "2 TW Alexander Drive", "rule"), seg("b", "2 TW ALEXANDER DRIVE", "2 TW ALEXANDER DRIVE", "rule")]);
  assert.deepEqual(changes, []);
});

test("a translation the reviewer corrected by hand wins and is never changed", () => {
  const changes = unifyRepeats([seg("a", "Name", "İsim", "tm-exact"), seg("b", "Name", "Ad", "human")]);
  assert.deepEqual(changes.map(({ id, translation }) => [id, translation]), [["a", "Ad"]]);
});

const DOC = [
  seg("p1", "1) Notification to and Confirmation from the US EPA of Legal Entity Name and Address Change in the USA", "1) ABD'deki tüzel kişilik adı ve adres değişikliğinin ABD EPA'ya bildirilmesi ve onaylanması"),
  seg("p2", "2) Notification to and Confirmation from the US EPA of Zip Code Update by United States Postal Service", "2) Posta kodu güncellemesine ilişkin ABD EPA'ya yapılan bildirim ve alınan onay"),
  seg("p3", "Company name", "Şirket adı"),
  seg("p4", "Name of the product", "Ürünün ismi"),
  seg("p5", "100 Park Avenue", "100 Park Avenue", "rule"),
  seg("p6", "Registration No. 7969", "Tescil No. 7969"),
];

test("applies the model's consistency fixes that pass the checks", async () => {
  const ask = async (prompt: string) => {
    assert.match(prompt, /p1/);
    assert.match(prompt, /"locked":true/);
    return JSON.stringify({
      changes: [
        { id: "p2", translation: "2) Posta kodu güncellemesinin ABD EPA'ya bildirilmesi ve onaylanması", reason: "aynı ifade" },
        { id: "p4", translation: "Ürünün adı", reason: "name → ad" },
      ],
    });
  };
  const changes = await harmonize(DOC, { sourceLang: "en-US", targetLang: "tr-TR", ask });
  assert.deepEqual(changes.map((change) => change.id), ["p2", "p4"]);
});

test("refuses fixes that touch a locked line, drop a protected number or make no change", async () => {
  const ask = async () =>
    JSON.stringify({
      changes: [
        { id: "p5", translation: "100 Park Caddesi" },
        { id: "p6", translation: "Tescil No." },
        { id: "p3", translation: "Şirket adı" },
        { id: "zz", translation: "?" },
        { id: "p4", translation: "" },
      ],
    });
  assert.deepEqual(await harmonize(DOC, { sourceLang: "en-US", targetLang: "tr-TR", ask }), []);
});

test("a model that fails leaves the translation as it was", async () => {
  const ask = async () => {
    throw new Error("no credits");
  };
  assert.deepEqual(await harmonize(DOC, { sourceLang: "en-US", targetLang: "tr-TR", ask }), []);
});

test("review puts addresses back, unifies repeats, then harmonizes", async () => {
  const segments = [
    seg("a", "100 Park Avenue", "100 Park Caddesi"),
    seg("b", "USA", "Amerika"),
    seg("c", "Sincerely,", "Saygılarımla,", "tm-exact"),
    seg("d", "Sincerely,", "Saygılar,"),
    seg("e", "Company name", "Firma ismi"),
  ];
  const ask = async () => JSON.stringify({ changes: [{ id: "e", translation: "Şirket adı", reason: "terim" }] });
  const result = await reviewDocument(segments, { sourceLang: "en-US", targetLang: "tr-TR", ask });
  const byId = Object.fromEntries(result.segments.map((s) => [s.id, s.translation]));
  assert.deepEqual(byId, { a: "100 Park Avenue", b: "ABD", c: "Saygılarımla,", d: "Saygılarımla,", e: "Şirket adı" });
  assert.equal(result.segments.find((s) => s.id === "a")?.source, "rule");
  assert.equal(result.changed, 4);
});
