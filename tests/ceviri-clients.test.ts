import assert from "node:assert/strict";
import test from "node:test";
import { parseAliases, slugify } from "../lib/ceviri/clients.ts";
import { firmFromProjectName, readScanTables, rowClientId } from "../lib/ceviri/project-firms.ts";

test("slugs are ASCII, lower case and dash separated", () => {
  assert.equal(slugify("Nase İlaç Tarım"), "nase-ilac-tarim");
  assert.equal(slugify("  BASF  "), "basf");
  assert.equal(slugify("Syngenta Crop Protection AG"), "syngenta-crop-protection-ag");
});

test("aliases are split on commas and new lines, trimmed and de-duplicated", () => {
  assert.deepEqual(parseAliases("Bayer, Bayer CropScience\nBayer Türk Kimya, bayer"), ["Bayer", "Bayer CropScience", "Bayer Türk Kimya"]);
});

test("project names that carry the firm", () => {
  assert.equal(firmFromProjectName("basf 11-08"), "basf");
  assert.equal(firmFromProjectName("syn 25-02"), "syngenta");
  assert.equal(firmFromProjectName("syng 30-04 ru-tr"), "syngenta");
  assert.equal(firmFromProjectName("Syngenta-güncel"), "syngenta");
  assert.equal(firmFromProjectName("NASE-07-10-TR"), "nase");
  assert.equal(firmFromProjectName("synthesis report"), null);
  assert.equal(firmFromProjectName("MATECAT_PROJ-202509181257"), null);
});

test("a memory row belongs to a firm only when every project name agrees", () => {
  const mapping = new Map<string, string | null>([["basf 11-08", "B"], ["basf 12-01", "B"], ["syn 25-02", "S"], ["diploma", null]]);
  assert.equal(rowClientId(["basf 11-08", "basf 12-01"], mapping), "B");
  assert.equal(rowClientId(["basf 11-08", "syn 25-02"], mapping), null, "two firms: shared");
  assert.equal(rowClientId(["basf 11-08", "diploma"], mapping), null, "used outside the firm too");
  assert.equal(rowClientId(["basf 11-08", "unknown"], mapping), null, "unmapped name");
  assert.equal(rowClientId(["basf 11-08", "lingua-düzeltme"], mapping), "B", "correction tag is ignored");
  assert.equal(rowClientId([], mapping), null);
});

test("reads the scan tables: named, fingerprinted, general and pending projects", () => {
  const groups = [
    "firma\tneden\tproje_id\tproje_adi\tcumle\tdiller",
    "basf\tproje adı\t1\tbasf 11-08\t300\ten-tr",
    "syngenta\tmetin (Syngenta:40)\t2\tMATECAT_PROJ-1\t1200\ten-tr",
    "genel\tfirma adı yok\t3\tMATECAT_PROJ-2\t80\ten-tr",
    "?karışık\tSyngenta:11, Globachem:9\t4\tEk2- İtalya Etiketi\t140\tit-tr",
  ].join("\n");
  const unresolved = [
    "sonuc\tguven\tbelge_turu\tproje_id\tproje_adi\tmetin_ogesi\tgerekce",
    "syngenta\tyüksek\tzirai/kimya/ruhsat\t3\tMATECAT_PROJ-2\t160\ttopas, captan",
    "?belirsiz\tsyngenta:11 globachem:9\tzirai/kimya/ruhsat\t4\tEk2- İtalya Etiketi\t283\t",
  ].join("\n");
  const decisions = new Map(readScanTables(groups, unresolved).map((d) => [d.name, d]));
  assert.deepEqual([decisions.get("basf 11-08")?.firm, decisions.get("basf 11-08")?.decidedBy], ["basf", "name"]);
  assert.deepEqual([decisions.get("MATECAT_PROJ-1")?.firm, decisions.get("MATECAT_PROJ-1")?.decidedBy], ["syngenta", "text"]);
  assert.deepEqual([decisions.get("MATECAT_PROJ-2")?.firm, decisions.get("MATECAT_PROJ-2")?.decidedBy], ["syngenta", "fingerprint"]);
  assert.equal(decisions.get("Ek2- İtalya Etiketi")?.pending, true);
  assert.equal(decisions.get("Ek2- İtalya Etiketi")?.firm, null);
});

test("slugs keep digits and the letters a regex range could swallow", () => {
  assert.equal(slugify("Revycare 360 SC (f)"), "revycare-360-sc-f");
  assert.equal(slugify("Çağdaş Ürün 2025"), "cagdas-urun-2025");
});
