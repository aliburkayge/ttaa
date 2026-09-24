import { countCase, isProper, tokensOf, type CaseCounts } from "./fold";

/**
 * Firma parmak izi (spec 5.2): firmayı ayırt eden özel adlar ve kodlar
 * (ürün adları, BAS kodları, tesis adları). Eski arşiv taramasında firma adı
 * geçmeyen 16 Syngenta projesi Topas, Captan, Tonghai gibi ifadelerden
 * bulundu. `docs` birer proje ya da belgedir; firması bilinmeyenler de sayıma
 * girer: bir kelimenin ne kadar yaygın olduğunu onlar gösterir.
 */

export type SignatureDoc = { clientId: string | null; texts: string[] };
export type Signature = { clientId: string; token: string; weight: number; rows: number };

export const SIGNATURE_RULES = { minDocs: 2, minRows: 3, minShare: 0.9, maxDocs: 25 };

export function buildSignatures(docs: SignatureDoc[], rules = SIGNATURE_RULES): Signature[] {
  const counts: CaseCounts = { proper: new Map(), all: new Map() };
  const byToken = new Map<string, { docs: number; perClient: Map<string, { docs: number; rows: number }> }>();

  for (const doc of docs) {
    countCase(doc.texts, counts);
    const rows = new Map<string, number>();
    for (const text of doc.texts) for (const token of tokensOf(text)) rows.set(token, (rows.get(token) ?? 0) + 1);
    for (const [token, n] of rows) {
      let entry = byToken.get(token);
      if (!entry) byToken.set(token, (entry = { docs: 0, perClient: new Map() }));
      entry.docs += 1;
      if (!doc.clientId) continue;
      const own = entry.perClient.get(doc.clientId) ?? { docs: 0, rows: 0 };
      own.docs += 1;
      own.rows += n;
      entry.perClient.set(doc.clientId, own);
    }
  }

  const signatures: Signature[] = [];
  for (const [token, entry] of byToken) {
    if (entry.docs > rules.maxDocs || !entry.perClient.size) continue;
    const labeled = [...entry.perClient.values()].reduce((sum, value) => sum + value.docs, 0);
    const [clientId, best] = [...entry.perClient].sort((a, b) => b[1].docs - a[1].docs)[0];
    const share = best.docs / labeled;
    if (best.docs < rules.minDocs || best.rows < rules.minRows || share < rules.minShare) continue;
    if (!isProper(token, counts)) continue;
    signatures.push({ clientId, token, weight: share, rows: best.rows });
  }
  return signatures;
}
