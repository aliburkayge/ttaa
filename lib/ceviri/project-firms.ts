/**
 * Eski belleğin firmalara dağıtılması (spec 5.3). TMX arşivleri tek müşteriye
 * ait değil: 742 projenin bir kısmı adından (basf…, syn…, nase…), bir kısmı
 * metninde geçen firma adından, bir kısmı da firma parmak izinden bir firmaya
 * bağlandı. Bu modül tarama tablolarını okur ve satır düzeyinde kararı verir.
 */

const NAME_RULES: Array<[RegExp, string]> = [
  [/basf/i, "basf"],
  [/syngenta|^syng?(?=[\s_\-\d]|$)/i, "syngenta"],
  [/(^|[^a-z])nase([^a-z]|$)/i, "nase"],
];

/** Proje adından firma; ad firmayı taşımıyorsa null. */
export function firmFromProjectName(name: string): string | null {
  for (const [pattern, slug] of NAME_RULES) if (pattern.test(name)) return slug;
  return null;
}

/** Çevirmen düzeltmesi etiketi: satırı bir projeye bağlamaz. */
const IGNORED = new Set(["lingua-düzeltme"]);

/**
 * Bir bellek satırının firması: bütün proje adları aynı firmaya eşleniyorsa o
 * firma. Aynı cümle çiftini iki firma kullanıyorsa çeviri zaten aynıdır ve
 * satır ortak (null) kalır. Eşlenmemiş ya da genel bir ad da satırı ortak yapar.
 * SQL'deki apply_project_clients() ile aynı kural.
 */
export function rowClientId(projectNames: string[], mapping: Map<string, string | null>): string | null {
  const names = projectNames.filter((name) => !IGNORED.has(name));
  if (!names.length) return null;
  const ids = names.map((name) => (mapping.has(name) ? mapping.get(name) : undefined));
  if (ids.some((id) => id === undefined || id === null)) return null;
  const unique = new Set(ids);
  return unique.size === 1 ? (ids[0] as string) : null;
}

export type ProjectDecision = {
  name: string;
  firm: string | null;
  pending: boolean;
  decidedBy: "name" | "text" | "fingerprint";
  sentences: number;
  evidence: Record<string, unknown>;
};

function rows(tsv: string): Array<Record<string, string>> {
  const [head, ...lines] = tsv.replace(/\r/g, "").trim().split("\n");
  const columns = head.split("\t");
  return lines.filter(Boolean).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]));
  });
}

const UNRESOLVED = new Set(["genel", "?karışık"]);

/**
 * Tarama tabloları: `firma-gruplari.tsv` (adı ya da metni belli projeler) ve
 * `belirsiz-siniflandirma.tsv` (geri kalanların parmak izi sonucu). Aynı ada
 * sahip iki proje farklı sonuç verirse ad bekleyene düşer.
 */
export function readScanTables(groups: string, unresolved: string): ProjectDecision[] {
  const byId = new Map(rows(unresolved).map((row) => [row.proje_id, row]));
  const byName = new Map<string, ProjectDecision>();
  for (const row of rows(groups)) {
    const sentences = Number(row.cumle) || 0;
    let decision: ProjectDecision;
    if (!UNRESOLVED.has(row.firma)) {
      decision = {
        name: row.proje_adi,
        firm: row.firma,
        pending: false,
        decidedBy: row.neden === "proje adı" ? "name" : "text",
        sentences,
        evidence: { reason: row.neden },
      };
    } else {
      const second = byId.get(row.proje_id);
      const result = second?.sonuc ?? "genel";
      const pending = result === "?belirsiz";
      decision = {
        name: row.proje_adi,
        firm: pending || result === "genel" ? null : result,
        pending,
        decidedBy: "fingerprint",
        sentences,
        evidence: {
          reason: row.neden,
          fingerprint: second?.gerekce ?? null,
          confidence: second?.guven ?? null,
          type: second?.belge_turu ?? null,
        },
      };
    }
    const seen = byName.get(decision.name);
    if (!seen) byName.set(decision.name, decision);
    else if (seen.firm !== decision.firm || seen.pending !== decision.pending) {
      byName.set(decision.name, {
        ...seen,
        firm: null,
        pending: true,
        sentences: seen.sentences + sentences,
        evidence: { reason: "aynı adlı projeler farklı firmalara çıktı" },
      });
    } else seen.sentences += sentences;
  }
  return [...byName.values()];
}

/** Firma kayıtlarının adı ve metinde aranacak tüzel adları (spec 5.2). */
export const DEFAULT_ALIASES: Record<string, { name: string; aliases: string[] }> = {
  basf: { name: "BASF", aliases: ["BASF Agricultural Solutions", "BASF Agro", "BASF SE"] },
  syngenta: { name: "Syngenta", aliases: ["Syngenta Crop Protection", "Syngenta Tarım"] },
  nase: { name: "Nase", aliases: ["Nase İlaç", "Nase Tarım"] },
  bayer: { name: "Bayer", aliases: ["Bayer CropScience", "Bayer Türk Kimya", "Bayer AG"] },
  sqm: { name: "SQM", aliases: ["SQM Europe", "Soquimich"] },
  novozymes: { name: "Novozymes", aliases: ["Novozymes Biologicals"] },
  yara: { name: "Yara", aliases: ["Yara International"] },
  globachem: { name: "Globachem", aliases: [] },
};
