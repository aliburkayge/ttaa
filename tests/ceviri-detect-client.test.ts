import assert from "node:assert/strict";
import test from "node:test";
import { DETECTION, decide, makerFor, nameHits, nameReliability, scoreClients, signatureHits } from "../lib/ceviri/detect-client.ts";

const CLIENTS = [
  { id: "basf", name: "BASF", aliases: ["BASF Agricultural Solutions"] },
  { id: "syngenta", name: "Syngenta", aliases: ["Syngenta Crop Protection"] },
  { id: "nase", name: "Nase", aliases: ["Nase İlaç"] },
];

test("names are found on word boundaries, folded, the long form counted once", () => {
  const hits = nameHits("BASF Agricultural Solutions GmbH and basf; not BASFİNE. SYNGENTA CROP PROTECTION AG", CLIENTS);
  assert.equal(hits.get("basf"), 2, "the full name once and lower-case basf once; BASFİNE is another word");
  assert.equal(hits.get("syngenta"), 1);
  assert.equal(hits.has("nase"), false);
});

test("signature tokens add up per firm", () => {
  const hits = signatureHits(["revysol", "workplace", "bas 703 07 f"], [
    { client_id: "basf", token: "revysol", weight: 1 },
    { client_id: "basf", token: "bas 703 07 f", weight: 0.95 },
  ]);
  assert.deepEqual(hits.get("basf")?.tokens.sort(), ["bas 703 07 f", "revysol"]);
  assert.ok(Math.abs((hits.get("basf")?.weight ?? 0) - 1.95) < 1e-9);
});

test("a BASF letter is detected automatically, with reasons", () => {
  const names = new Map([["basf", 2]]);
  const scored = scoreClients({ names, signature: new Map([["basf", { weight: 3, tokens: ["revysol"] }]]), memory: new Map([["basf", 8]]) });
  const detection = decide(scored, names);
  assert.equal(detection.decision, "auto");
  assert.equal(detection.clientId, "basf");
  assert.equal(detection.makerId, null);
  assert.ok(detection.candidates[0].reasons.some((r) => r.includes("8 cümle")));
});

test("without a single sentence in the firm's memory the choice is only a suggestion", () => {
  // Ad ve ürün izi güçlü ama bellekte hiç cümle yok: dağıtıcının belgesi olabilir.
  const names = new Map([["syngenta", 5]]);
  const scored = scoreClients({ names, signature: new Map([["syngenta", { weight: 10, tokens: ["dicamba"] }]]), memory: new Map() });
  assert.equal(scored[0].score, 19);
  assert.equal(decide(scored, names, { ...DETECTION, auto: 6 }).decision, "suggest");
});

test("a firm whose name mostly appears in other firms' documents counts less", () => {
  const reliability = nameReliability([
    { clientId: "nase", names: new Map([["bayer", 3]]) },
    { clientId: "nase", names: new Map([["bayer", 2]]) },
    { clientId: "nase", names: new Map([["bayer", 4]]) },
    { clientId: "bayer", names: new Map([["bayer", 3]]) },
    { clientId: "basf", names: new Map([["basf", 5]]) },
    { clientId: "basf", names: new Map([["basf", 2]]) },
  ]);
  assert.ok(Math.abs(reliability.get("bayer")! - 2 / 6) < 1e-9, "1 of 4, smoothed");
  assert.ok(Math.abs(reliability.get("basf")! - 3 / 4) < 1e-9, "2 of 2, smoothed");
  const names = new Map([["bayer", 3]]);
  const weighted = scoreClients({ names, signature: new Map(), memory: new Map(), nameWeight: reliability });
  assert.ok(Math.abs(weighted[0].score - 3) < 1e-9, "3 · (2/6) · 3");
});

test("a Nase document about a Syngenta product: customer from memory, maker from the name", () => {
  const names = new Map([["syngenta", 4]]);
  const scored = scoreClients({ names, signature: new Map(), memory: new Map([["nase", 12]]) });
  const detection = decide(scored, names);
  assert.equal(detection.decision, "auto");
  assert.equal(detection.clientId, "nase");
  assert.equal(detection.makerId, "syngenta");
});

test("no evidence or two close firms: ask", () => {
  assert.equal(decide(scoreClients({ names: new Map(), signature: new Map(), memory: new Map() }), new Map()).decision, "ask");
  const names = new Map([
    ["basf", 1],
    ["syngenta", 1],
  ]);
  const close = decide(scoreClients({ names, signature: new Map(), memory: new Map() }), names);
  assert.equal(close.decision, "ask");
  assert.equal(close.clientId, null);
});

test("moderate evidence is a suggestion", () => {
  const names = new Map([["basf", 1]]);
  const detection = decide(scoreClients({ names, signature: new Map(), memory: new Map() }), names);
  assert.equal(detection.decision, "suggest");
  assert.equal(detection.clientId, "basf");
});

test("with a customer chosen by hand, the maker is the other firm named most", () => {
  assert.equal(makerFor(new Map([["syngenta", 3], ["nase", 5]]), "nase"), "syngenta");
  assert.equal(makerFor(new Map([["syngenta", 1]]), "nase"), null, "a single mention is not enough");
  assert.equal(makerFor(new Map([["syngenta", 3]]), null), null, "no customer, no maker");
});
