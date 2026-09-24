import assert from "node:assert/strict";
import test from "node:test";
import { alignPhrases, harmonize, reviewDocument, sharedPhrases, unifyRepeats } from "../lib/ceviri/consistency.ts";

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

test("a line written in capitals stays in capitals", async () => {
  const segments = [
    seg("c1", "UNITED STATES ENVIRONMENTAL PROTECTION AGENCY", "AMERİKA BİRLEŞİK DEVLETLERİ ÇEVRE KORUMA AJANSI"),
    seg("c2", "U.S. Environmental Protection Agency", "ABD Çevre Koruma Ajansı"),
  ];
  const ask = async () =>
    JSON.stringify({ changes: [{ id: "c1", translation: "AMERİKA BİRLEŞİK DEVLETLERİ Çevre Koruma Ajansı" }] });
  assert.deepEqual(await harmonize(segments, { sourceLang: "en-US", targetLang: "tr-TR", ask }), []);
});

test("a model that fails leaves the translation as it was", async () => {
  const ask = async () => {
    throw new Error("no credits");
  };
  assert.deepEqual(await harmonize(DOC, { sourceLang: "en-US", targetLang: "tr-TR", ask }), []);
});

const LIST = [
  seg("e1", "1) Notification to and Confirmation from the US EPA of Legal Entity Name and Address Change in the USA", "1) ABD’deki tüzel kişilik adı ve adres değişikliğinin ABD EPA’ya bildirilmesi ve EPA tarafından onaylanması"),
  seg("e2", "2) Notification to and Confirmation from the US EPA of Zip Code Update by United States Postal Service", "2) ABD Posta Servisi tarafından yapılan posta kodu güncellemesine ilişkin ABD EPA’ya yapılan bildirim ve alınan onay"),
  seg("a1", "Attachment #1: Notification to and Confirmation from the US EPA of Legal Entity Name and Address Change in the USA", "Ek #1: ABD’deki tüzel kişilik adı ve adres değişikliğinin ABD EPA’ya bildirilmesi ve EPA tarafından onaylanması"),
  seg("a2", "Attachment #2: Notification to and Confirmation from the US EPA of Zip Code Update by United States Postal Service", "Ek #2: ABD Posta Servisi tarafından yapılan posta kodu güncellemesine ilişkin ABD EPA’ya yapılan bildirim ve alınan onay"),
  seg("n1", "Current name and address: BASF Corporation", "Mevcut adı ve adresi: BASF Corporation"),
  seg("n2", "New name and address: BASF Agricultural Solutions US LLC", "Yeni ad ve adres: BASF Agricultural Solutions US LLC"),
  seg("b1", "BASF Agricultural Solutions US LLC will continue to operate", "BASF Agricultural Solutions US LLC faaliyetine devam edecek"),
  seg("x1", "Sincerely,", "Saygılarımla,"),
];

test("finds the groups of lines that share source wording", () => {
  const groups = sharedPhrases(LIST).map((group) => [...group.ids].sort());
  assert.deepEqual(groups, [
    ["a1", "a2", "e1", "e2"],
    ["n1", "n2"],
  ]);
});

const ALIGNED_E2 = "2) ABD Posta Servisi tarafından yapılan posta kodu güncellemesinin ABD EPA’ya bildirilmesi ve EPA tarafından onaylanması";
const ALIGNED_A2 = "Ek #2: ABD Posta Servisi tarafından yapılan posta kodu güncellemesinin ABD EPA’ya bildirilmesi ve EPA tarafından onaylanması";

test("makes shared wording read the same, asking about one group at a time", async () => {
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    if (prompt.includes('"id":"e1"'))
      return JSON.stringify({ changes: [{ id: "e2", translation: ALIGNED_E2 }, { id: "a2", translation: ALIGNED_A2 }] });
    return JSON.stringify({ changes: [{ id: "n1", translation: "Mevcut ad ve adres: BASF Corporation", reason: "ad ve adres" }] });
  };
  const changes = await alignPhrases(LIST, { sourceLang: "en-US", targetLang: "tr-TR", ask });
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /"id":"n1"/);
  assert.deepEqual(
    changes.map(({ id, translation }) => [id, translation]),
    [
      ["e2", ALIGNED_E2],
      ["a2", ALIGNED_A2],
      ["n1", "Mevcut ad ve adres: BASF Corporation"],
    ],
  );
});

test("refuses a group rewrite that does not make the shared wording more alike", async () => {
  const ask = async (prompt: string) =>
    prompt.includes('"id":"e1"')
      ? JSON.stringify({ changes: [{ id: "e2", translation: "2) ABD Posta Servisi’nin posta kodu güncellemesine dair EPA’ya bildirim ve EPA’dan onay" }] })
      : JSON.stringify({ changes: [] });
  assert.deepEqual(await alignPhrases(LIST, { sourceLang: "en-US", targetLang: "tr-TR", ask }), []);
});

test("a line that repeats word for word gets the aligned wording too", async () => {
  const segments = [...LIST, seg("e2b", LIST[1].text, LIST[1].translation as string)];
  const ask = async (prompt: string) => {
    assert.doesNotMatch(prompt, /"id":"e2b"/);
    return prompt.includes('"id":"e1"')
      ? JSON.stringify({ changes: [{ id: "e2", translation: ALIGNED_E2 }, { id: "a2", translation: ALIGNED_A2 }] })
      : JSON.stringify({ changes: [] });
  };
  const changes = await alignPhrases(segments, { sourceLang: "en-US", targetLang: "tr-TR", ask });
  assert.deepEqual(changes.map((change) => change.id).sort(), ["a2", "e2", "e2b"]);
});

test("review keeps the aligned lines as they are when it harmonizes the rest", async () => {
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    if (prompt.includes("share wording") && prompt.includes('"id":"e1"'))
      return JSON.stringify({ changes: [{ id: "e2", translation: ALIGNED_E2 }, { id: "a2", translation: ALIGNED_A2 }] });
    if (prompt.includes("share wording")) return JSON.stringify({ changes: [] });
    return JSON.stringify({ changes: [{ id: "e2", translation: "2) başka bir çeviri, ABD Posta Servisi" }] });
  };
  const result = await reviewDocument(LIST, { sourceLang: "en-US", targetLang: "tr-TR", ask });
  assert.equal(result.segments.find((s) => s.id === "e2")?.translation, ALIGNED_E2);
  assert.match(prompts.at(-1) as string, /"id":"e2"[^\n]*"locked":true/);
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

test("lines of a sentence translated whole are locked: the review cannot rewrite one piece", async () => {
  // "Jacquard 69727 Genay, France in" adrese benzer; adres kuralı parçayı İngilizceye çevirip cümleyi bozuyordu.
  const unit = (id: string, text: string, translation: string) => ({ ...seg(id, text, translation), unit: "u1" });
  const segments = [
    unit("u1", "SC will be manufactured at the plant located at Z.I. Lyon Nord, Rue", "SC markalı ürünümüzün; Fransa, Z.I. Lyon Nord, Rue"),
    unit("u2", "Jacquard 69727 Genay, France", "Jacquard 69727 Genay adresindeki tesiste üretileceğini"),
    seg("x", "Jacquard 69727 Genay, France", "Jacquard 69727 Genay, Fransa"),
  ];
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    return JSON.stringify({ changes: [{ id: "u1", translation: "başka bir çeviri, Z.I. Lyon Nord, Rue", reason: "x" }] });
  };
  const result = await reviewDocument(segments, { sourceLang: "en-US", targetLang: "tr-TR", ask });
  const byId = Object.fromEntries(result.segments.map((s) => [s.id, s.translation]));
  assert.equal(byId.u1, "SC markalı ürünümüzün; Fransa, Z.I. Lyon Nord, Rue");
  assert.equal(byId.u2, "Jacquard 69727 Genay adresindeki tesiste üretileceğini");
  assert.ok(prompts.every((prompt) => !/"id":"u[12]"(?![^\n]*"locked":true)/.test(prompt)));
});
