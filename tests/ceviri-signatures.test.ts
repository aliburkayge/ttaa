import assert from "node:assert/strict";
import test from "node:test";
import { buildSignatures } from "../lib/ceviri/signatures.ts";

const doc = (clientId: string | null, ...texts: string[]) => ({ clientId, texts });

test("a product name used only in one firm's documents becomes its signature", () => {
  const signatures = buildSignatures([
    doc("basf", "We apply Revysol on wheat.", "The workplace must be clean.", "The Revysol label is stable."),
    doc("basf", "Apply Revysol twice.", "Our workplace rules apply."),
    doc("syngenta", "Always use Touchdown carefully.", "It said Touchdown kills weeds.", "The workplace matters."),
    doc("syngenta", "Store Touchdown below 30 °C."),
    doc(null, "A safe workplace is important."),
  ]);
  const byToken = new Map(signatures.map((s) => [s.token, s]));
  assert.equal(byToken.get("revysol")?.clientId, "basf");
  assert.equal(byToken.get("touchdown")?.clientId, "syngenta");
  assert.equal(byToken.has("workplace"), false, "everyday words are not signatures");
});

test("a code seen in one firm's documents is a signature; a name used by two firms is not", () => {
  const signatures = buildSignatures([
    doc("basf", "Product BAS 703 07 F registered by Bayer."),
    doc("basf", "BAS 703 07 F label. Also mentions Bayer."),
    doc("basf", "Formulation BAS 703 07 F."),
    doc("syngenta", "Supplied by Bayer to us."),
    doc("syngenta", "Contract with Bayer."),
  ]);
  const tokens = signatures.map((s) => `${s.clientId}:${s.token}`);
  assert.ok(tokens.includes("basf:bas 703 07 f"));
  assert.equal(tokens.some((t) => t.endsWith(":bayer")), false);
});
