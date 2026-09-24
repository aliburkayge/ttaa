import assert from "node:assert/strict";
import test from "node:test";
import { adjustedScore, chainClientIds, pickScoped, termRank, type ScopeChain } from "../lib/ceviri/scope.ts";
import type { TermHit } from "../lib/ceviri/term-store.ts";

const CHAIN: ScopeChain = { clientId: "nase", makerId: "syngenta", sectorId: "zirai" };

function hit(partial: Partial<TermHit>): TermHit {
  return { conceptId: "c", scopeType: "global", scopeId: null, sourceText: "registration", targetText: "tescil", isForbidden: false, notes: null, ...partial };
}

test("the chain lists the customer before the maker, without duplicates", () => {
  assert.deepEqual(chainClientIds(CHAIN), ["nase", "syngenta"]);
  assert.deepEqual(chainClientIds({ clientId: "basf", makerId: "basf", sectorId: null }), ["basf"]);
  assert.deepEqual(chainClientIds({ clientId: null, makerId: null, sectorId: null }), []);
});

test("customer outranks maker outranks sector outranks general; other firms do not count", () => {
  assert.equal(termRank(hit({ scopeType: "client", scopeId: "nase" }), CHAIN), 4);
  assert.equal(termRank(hit({ scopeType: "client", scopeId: "syngenta" }), CHAIN), 3);
  assert.equal(termRank(hit({ scopeType: "sector", scopeId: "zirai" }), CHAIN), 2);
  assert.equal(termRank(hit({}), CHAIN), 1);
  assert.equal(termRank(hit({ scopeType: "client", scopeId: "bayer" }), CHAIN), 0);
});

test("the customer's term wins and the general one is recorded as replaced, not forbidden", () => {
  const general = hit({ conceptId: "g", targetText: "tescil" });
  const firm = hit({ conceptId: "f", scopeType: "client", scopeId: "nase", targetText: "ruhsat" });
  const result = pickScoped([general, firm], CHAIN);
  assert.deepEqual(result.preferred.map((h) => h.targetText), ["ruhsat"]);
  assert.deepEqual(result.replaced.map((r) => [r.term.targetText, r.by.targetText]), [["tescil", "ruhsat"]]);
  assert.deepEqual(result.forbidden, []);
});

test("a general prohibition stays unless a narrower scope prefers that very word", () => {
  const banned = hit({ conceptId: "g", targetText: "kayıt", isForbidden: true });
  assert.equal(pickScoped([banned], CHAIN).forbidden.length, 1);
  const firmWants = hit({ conceptId: "f", scopeType: "client", scopeId: "nase", targetText: "kayıt" });
  assert.equal(pickScoped([banned, firmWants], CHAIN).forbidden.length, 0);
});

test("another firm's terms are ignored entirely", () => {
  const bayer = hit({ scopeType: "client", scopeId: "bayer", targetText: "ruhsatlandırma" });
  const general = hit({ targetText: "tescil" });
  assert.deepEqual(pickScoped([bayer, general], CHAIN).preferred.map((h) => h.targetText), ["tescil"]);
});

test("a firm's 95% match outranks a stranger's 100% match, but raw score is kept", () => {
  const own = { score: 0.95, client_id: "nase", sector_id: null, origin: "tmx-import" };
  const stranger = { score: 1, client_id: "bayer", sector_id: null, origin: "tmx-import" };
  assert.ok(adjustedScore(own, CHAIN) > adjustedScore(stranger, CHAIN));
  assert.equal(own.score, 0.95);
  const approved = { score: 0.9, client_id: null, sector_id: null, origin: "human-approved" };
  assert.ok(Math.abs(adjustedScore(approved, CHAIN) - 0.93) < 1e-9);
});
