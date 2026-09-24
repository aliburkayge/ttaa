import assert from "node:assert/strict";
import test from "node:test";
import { generalCheck, logLikelihood, mineTerms, stem } from "../lib/ceviri/term-mining.ts";

test("stems long words to six letters so Turkish suffixes count together", () => {
  assert.equal(stem("ruhsatı"), "ruhsat");
  assert.equal(stem("ruhsatının"), "ruhsat");
  assert.equal(stem("doz"), "doz");
});

test("log-likelihood is zero when the rates match and grows as they differ", () => {
  assert.ok(Math.abs(logLikelihood(10, 100, 100, 1000)) < 1e-9);
  assert.ok(logLikelihood(10, 1, 100, 1000) > 10.83);
});

test("finds the firm's own rendering of a frequent term, not everyday words", () => {
  const firm = [
    { source: "The registration of the product expires.", target: "Ürünün ruhsatı sona erer." },
    { source: "Registration number of the product", target: "Ürünün ruhsat numarası" },
    { source: "The registration holder is responsible.", target: "Ruhsat sahibi sorumludur." },
    { source: "The registration was renewed in 2024.", target: "Ruhsat 2024 yılında yenilendi." },
    { source: "Apply for registration before use.", target: "Kullanmadan önce ruhsat için başvurun." },
    { source: "Keep the product dry.", target: "Ürünü kuru tutun." },
  ];
  const reference = Array.from({ length: 40 }, (_, i) => (i % 2 ? "Keep the product in a dry place." : "The product label must be read."));
  const mined = mineTerms(firm, reference, { source: "en-US", target: "tr-TR" });
  const registration = mined.find((term) => term.source === "registration");
  assert.ok(registration, JSON.stringify(mined.map((m) => m.source)));
  assert.equal(registration.target, "ruhsat");
  assert.ok(registration.dice >= 0.5);
  assert.equal(
    mined.some((term) => term.source === "product"),
    false,
    "the reference corpus uses 'product' as much",
  );
});

// Gerçek BASF belleğinde ilk denemede çıkan gürültü: çevrilmeyen adlar, birimler, Türkçe küçük harfle bozulan kısaltmalar.
const PAIRS = [
  { source: "Water content of BASF Agro B.V. Arnhem technical material, CIPAC MT 30.5 at 20 °C", target: "BASF Agro B.V. Arnhem teknik maddesinin su içeriği, CIPAC MT 30.5, 20 °C'de" },
  { source: "The water content of the formulation was measured, CIPAC MT 30.5 at 20 °C", target: "Formülasyonun su içeriği ölçüldü, CIPAC MT 30.5, 20 °C'de" },
  { source: "Water content: max 0.5 g/l (CIPAC MT 30.5)", target: "Su içeriği: en fazla 0,5 g/l (CIPAC MT 30.5)" },
  { source: "Determine the water content with CIPAC MT 30.5 at 20 °C", target: "Su içeriğini CIPAC MT 30.5 ile 20 °C'de belirleyin" },
  { source: "Water content of BASF Agro B.V. Arnhem samples, CIPAC MT 30.5", target: "BASF Agro B.V. Arnhem numunelerinin su içeriği, CIPAC MT 30.5" },
];
const PLAIN = Array.from({ length: 40 }, () => "The label must be read before use.");

test("names that stay the same and units are not term suggestions", () => {
  const mined = mineTerms(PAIRS, PLAIN, { source: "en-US", target: "tr-TR" });
  const sources = mined.map((term) => term.source);
  for (const noise of ["basf", "arnhem", "basf agro b v", "20 c", "g l", "cipac mt"]) {
    assert.equal(sources.includes(noise), false, `${noise} should not be suggested: ${JSON.stringify(mined.map((m) => `${m.source}→${m.target}`))}`);
  }
});

test("a two-letter Turkish word can be the translation", () => {
  const mined = mineTerms(PAIRS, PLAIN, { source: "en-US", target: "tr-TR" });
  const water = mined.find((term) => term.source === "water content" || term.source === "water");
  assert.ok(water, JSON.stringify(mined.map((m) => `${m.source}→${m.target}`)));
  assert.match(water.target, /^su( içeri)?/i);
});

test("the suggestion keeps the original spelling of the translation", () => {
  // Türkçe küçük harfe çevirmede "CIPAC" → "cıpac" olur; öneri özgün yazılışla gelmeli.
  const firm = [
    { source: "CIPAC purity of the sample", target: "Numunenin CIPAC saflığı" },
    { source: "The CIPAC purity is high", target: "CIPAC saflığı yüksek" },
    { source: "Report CIPAC purity", target: "CIPAC saflığını bildirin" },
  ];
  const mined = mineTerms(firm, PLAIN, { source: "en-US", target: "tr-TR" });
  const purity = mined.find((term) => term.source === "cipac purity");
  assert.ok(purity, JSON.stringify(mined.map((m) => `${m.source}→${m.target}`)));
  assert.equal(purity.target, "CIPAC saflığı");
});

test("sentence fragments with function words or one-letter tails are not terms", () => {
  const firm = [
    { source: "The formulation shall continue to comply after storage", target: "Formülasyon depolamadan sonra uyumlu olmaya devam etmelidir" },
    { source: "The concentrate shall continue to comply after storage", target: "Konsantre depolamadan sonra uyumlu olmaya devam etmelidir" },
    { source: "The granules shall continue to comply after storage", target: "Granüller depolamadan sonra uyumlu olmaya devam etmelidir" },
    { source: "Dilute with CIPAC water D", target: "CIPAC D suyu ile seyreltin" },
    { source: "Disperse in CIPAC water D", target: "CIPAC D suyunda dağıtın" },
    { source: "Use CIPAC water D at 30 °C", target: "30 °C'de CIPAC D suyu kullanın" },
  ];
  const mined = mineTerms(firm, PLAIN, { source: "en-US", target: "tr-TR" });
  const sources = mined.map((term) => term.source);
  assert.equal(sources.some((source) => / (shall|to) /.test(` ${source} `)), false, JSON.stringify(sources));
  assert.equal(sources.some((source) => /(^| )\p{L}$/u.test(source)), false, JSON.stringify(sources));
});

test("a translation already claimed by a stronger term is not given to an unrelated one", () => {
  const firm = [
    { source: "State the purity of the sample", target: "Numunenin saflığını belirtiniz" },
    { source: "State the purity", target: "Saflığını belirtiniz" },
    { source: "State purity in the report", target: "Raporda saflığını belirtiniz" },
    { source: "The purity was measured", target: "Saflığı ölçüldü" },
    { source: "Purity must be reported", target: "Saflığı raporlanmalıdır" },
    { source: "High purity", target: "Yüksek saflık" },
    // "belirtiniz" başka satırlarda da geçer: tek başına Dice'ı düşer, "saflığını belirtiniz" öne çıkar.
    { source: "Indicate the batch", target: "Partiyi belirtiniz" },
    { source: "Indicate the date", target: "Tarihi belirtiniz" },
    { source: "Indicate the origin", target: "Menşei belirtiniz" },
  ];
  const mined = mineTerms(firm, [...PLAIN, ...PLAIN, ...PLAIN, ...PLAIN, ...PLAIN], { source: "en-US", target: "tr-TR" });
  const state = mined.find((term) => term.source === "state");
  assert.ok(state, JSON.stringify(mined.map((m) => `${m.source}→${m.target}`)));
  assert.equal(state.target, "belirtiniz", "the next free translation, not the one purity owns");
  // Eş anlamlılar aynı karşılığı paylaşabilir: tekel cümle içinde, türde değil.
  assert.equal(mined.find((term) => term.source === "indicate")?.target, "belirtiniz");
});

test("the translation is shown in dictionary case, keeping acronyms", () => {
  const firm = [
    { source: "Storage stability", target: "DEPOLAMA STABİLİTESİ" },
    { source: "Storage stability was tested", target: "Depolama stabilitesi test edildi" },
    { source: "The storage stability is good", target: "Depolama stabilitesi iyi" },
    { source: "Report storage stability", target: "Depolama stabilitesini bildirin" },
  ];
  const mined = mineTerms(firm, PLAIN, { source: "en-US", target: "tr-TR" });
  const term = mined.find((m) => m.source === "storage stability");
  assert.ok(term, JSON.stringify(mined.map((m) => `${m.source}→${m.target}`)));
  assert.equal(term.target, "depolama stabilitesi");
});

test("Turkish inflections of a word share one stem", () => {
  for (const [word, root] of [
    ["partiden", "parti"],
    ["partilerin", "parti"],
    ["saflığını", "saflık"],
    ["sıcaklığı", "sıcaklık"],
    ["maddesi", "madde"],
    ["ürünün", "ürün"],
    ["sonucu", "sonuç"],
  ]) {
    assert.equal(stem(word, "tr-TR"), stem(root, "tr-TR"), `${word} ~ ${root}`);
  }
  assert.notEqual(stem("numune", "tr-TR"), stem("numara", "tr-TR"));
  assert.equal(stem("su", "tr-TR"), "su");
});

test("an all-caps heading word is lowered unless the source has it too", () => {
  const firm = [
    { source: "Figure 1", target: "ŞEKİL 1" },
    { source: "Figure 2 shows the peak", target: "ŞEKİL 2 pikleri gösterir" },
    { source: "See Figure 3", target: "Bkz. ŞEKİL 3" },
  ];
  const mined = mineTerms(firm, PLAIN, { source: "en-US", target: "tr-TR" });
  const figure = mined.find((term) => term.source === "figure");
  assert.ok(figure, JSON.stringify(mined.map((m) => `${m.source}→${m.target}`)));
  assert.equal(figure.target, "şekil");
});

test("the pair with the stronger bond wins a shared word, whatever the source's frequency", () => {
  // "five representative batches" → "temsili beş parti": "batches" daha sık, ama "beş"le bağı "five"ınkinden zayıf.
  const firm = [
    { source: "Five representative batches were analysed", target: "Temsili beş parti analiz edildi" },
    { source: "Results of five representative batches", target: "Temsili beş partinin sonuçları" },
    { source: "Five representative batches are listed", target: "Temsili beş parti listelenmiştir" },
    { source: "Five samples", target: "Beş numune" },
    { source: "Batches were stored", target: "Partiler depolandı" },
    { source: "All batches comply", target: "Tüm partiler uyumludur" },
    { source: "Batches of the product", target: "Ürünün partileri" },
  ];
  const mined = mineTerms(firm, [...PLAIN, ...PLAIN, ...PLAIN], { source: "en-US", target: "tr-TR" });
  const shown = JSON.stringify(mined.map((m) => `${m.source}→${m.target}`));
  assert.equal(mined.find((m) => m.source === "batches")?.target, "parti", shown);
  assert.equal(mined.find((m) => m.source === "five")?.target, "beş", shown);
});

test("units are never part of a term on either side", () => {
  const firm = [
    { source: "Dissolve 0.5 mg/ml test item in water", target: "0,5 mg/ml test maddesini suda çözün" },
    { source: "The 1 mg/ml test item solution", target: "1 mg/ml test maddesi çözeltisi" },
    { source: "Prepare 2 mg/ml test item", target: "2 mg/ml test maddesi hazırlayın" },
    { source: "Weigh the test item", target: "Test maddesini tartın" },
  ];
  const mined = mineTerms(firm, PLAIN, { source: "en-US", target: "tr-TR" });
  const shown = JSON.stringify(mined.map((m) => `${m.source}→${m.target}`));
  assert.equal(mined.some((m) => /(^| )(mg|ml)( |$)/i.test(m.source) || /(^| )(mg|ml)( |$)/i.test(m.target)), false, shown);
  assert.equal(mined.find((m) => m.source === "test item")?.target, "test maddesi", shown);
});

test("polite template words and codes do not make terms", () => {
  const firm = [
    { source: "For payment please indicate partner number 4711", target: "Ödeme yaparken lütfen 4711 sayılı ortak numarasını belirtin" },
    { source: "For payment please indicate partner number 4712", target: "Ödeme yaparken lütfen 4712 sayılı ortak numarasını belirtin" },
    { source: "For payment please indicate partner number 4713", target: "Ödeme yaparken lütfen 4713 sayılı ortak numarasını belirtin" },
    { source: "Strain FZB24 was grown", target: "FZB24 suşu üretildi" },
    { source: "Strain FZB24 is stable", target: "FZB24 suşu kararlıdır" },
    { source: "The strain FZB24 genome", target: "FZB24 suşunun genomu" },
  ];
  const mined = mineTerms(firm, PLAIN, { source: "en-US", target: "tr-TR" });
  const shown = JSON.stringify(mined.map((m) => `${m.source}→${m.target}`));
  assert.equal(mined.some((m) => /(^| )(please|lütfen)( |$)/.test(m.source) || /(^| )lütfen( |$)/.test(m.target)), false, shown);
  assert.equal(mined.some((m) => /\d/.test(m.source)), false, shown);
});

test("a firm difference is real only when the firm does not use the general translation", () => {
  const firm = [
    { source: "The active ingredient content", target: "Aktif madde içeriği" },
    { source: "Active ingredient purity", target: "Aktif madde saflığı" },
    { source: "The active ingredient is stable", target: "Aktif bileşen kararlıdır" },
    { source: "Delivery date", target: "Teslim tarihi" },
    { source: "Delivery address", target: "Teslim adresi" },
    { source: "Dissolve the solution", target: "Solüsyonu çözün" },
  ];
  const check = generalCheck(firm, { source: "en-US", target: "tr-TR" });
  assert.equal(check({ source: "solution", target: "solüsyonu" }, []), "none", "no general term");
  assert.equal(check({ source: "solution", target: "solüsyonu" }, ["solüsyon"]), "same", "same word, other inflection");
  assert.equal(check({ source: "active ingredient", target: "aktif" }, ["aktif madde"]), "same", "the firm mostly uses the general term");
  assert.equal(check({ source: "delivery", target: "teslim" }, ["teslimat"]), "differs");
});

test("a root that ends in n keeps it", () => {
  assert.equal(stem("solüsyonu", "tr-TR"), stem("solüsyon", "tr-TR"));
  assert.equal(stem("yöntemini", "tr-TR"), stem("yöntem", "tr-TR"));
  assert.equal(stem("partisini", "tr-TR"), stem("parti", "tr-TR"));
});
