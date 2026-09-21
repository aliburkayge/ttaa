import { deleteVerificationPdf, importVerificationPdf, type VerificationPdfBrand } from "../lib/verification-pdf-storage";
import { findAyVerificationMediaId, listAyVerificationDocuments, setAyVerificationPdf } from "../lib/ay-verification-wordpress";
import { findTtaaVerificationMediaId, listTtaaVerificationDocuments, setTtaaVerificationPdf } from "../lib/ttaa-verification-wordpress";
import { deleteWordPressMedia } from "../lib/wordpress";

const apply = process.argv.includes("--apply");

async function allRecords(brand: VerificationPdfBrand) {
  const records: Array<{ id: number; token: string; url: string; details: { fileKey?: string; fileUrl?: string; mediaId?: number } }> = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = brand === "ttaa" ? await listTtaaVerificationDocuments("", page) : await listAyVerificationDocuments("", page);
    records.push(...result.records);
    if (!result.hasMore) break;
  }
  return records;
}

async function migrateBrand(brand: VerificationPdfBrand) {
  const records = await allRecords(brand);
  const legacy = records.filter((record) => record.details.fileUrl && !record.details.fileKey);
  process.stdout.write(`${brand}: ${legacy.length} açık WordPress PDF kaydı bulundu.\n`);
  if (!apply) return { found: legacy.length, migrated: 0, warnings: [] as string[] };
  let migrated = 0;
  const warnings: string[] = [];
  for (const record of legacy) {
    const fileUrl = record.details.fileUrl!;
    const stored = await importVerificationPdf(brand, record.token, fileUrl);
    try {
      if (brand === "ttaa") await setTtaaVerificationPdf(record.token, { key: stored.key });
      else await setAyVerificationPdf(record.token, { key: stored.key });
    } catch (error) {
      await deleteVerificationPdf(brand, record.token, stored.key).catch(() => undefined);
      throw error;
    }
    const mediaId = brand === "ttaa"
      ? await findTtaaVerificationMediaId(fileUrl, record.id, record.details.mediaId).catch(() => undefined)
      : await findAyVerificationMediaId(fileUrl, record.id, record.details.mediaId).catch(() => undefined);
    if (mediaId) {
      try { await deleteWordPressMedia(mediaId, brand); }
      catch { warnings.push(`${brand} ${record.token}: eski WordPress ortam dosyası silinemedi.`); }
    } else warnings.push(`${brand} ${record.token}: eski WordPress ortam kaydı bulunamadı.`);
    migrated += 1;
    process.stdout.write(`${brand}: ${migrated}/${legacy.length} güvenli depoya taşındı.\n`);
  }
  return { found: legacy.length, migrated, warnings };
}

const results = [];
for (const brand of ["ay-tercume", "ttaa"] as const) results.push(await migrateBrand(brand));
const warningCount = results.reduce((sum, result) => sum + result.warnings.length, 0);
process.stdout.write(apply ? `Taşıma tamamlandı. Uyarı: ${warningCount}.\n` : "Bu bir ön kontroldü. Taşımak için --apply kullanın.\n");
for (const warning of results.flatMap((result) => result.warnings)) process.stdout.write(`${warning}\n`);
