import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";
import { validatePrototypeDetails, type PrototypeDetails } from "./qr-prototype";

const BUCKET = "ttaa-qr-private";
const recordPrefix = "ttaa/records";
let bucketReady: Promise<void> | undefined;

export type TtaaQrRecord = {
  id: string;
  details: PrototypeDetails;
  createdAt: string;
  updatedAt: string;
  pdfPath?: string;
  pdfName?: string;
};

function recordId(number: string) {
  return createHash("sha256").update(number.trim().toLocaleLowerCase("tr-TR")).digest("hex");
}

function recordPath(id: string) { return `${recordPrefix}/${id}.json`; }

async function bucket() {
  if (!bucketReady) bucketReady = (async () => {
    const storage = getSupabaseAdmin().storage;
    const { data, error } = await storage.listBuckets();
    if (error) throw new Error(`Belge deposu açılamadı: ${error.message}`);
    if (!data.some((item) => item.id === BUCKET)) {
      const { error: createError } = await storage.createBucket(BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ["application/pdf", "application/json"] });
      if (createError && !/already|exist|duplicate/i.test(createError.message)) throw new Error(`Belge deposu oluşturulamadı: ${createError.message}`);
    }
  })();
  try { await bucketReady; }
  catch (error) { bucketReady = undefined; throw error; }
  return getSupabaseAdmin().storage.from(BUCKET);
}

async function save(record: TtaaQrRecord) {
  const storage = await bucket();
  const data = new Blob([JSON.stringify(record)], { type: "application/json" });
  const { error } = await storage.upload(recordPath(record.id), data, { contentType: "application/json", upsert: true, cacheControl: "0" });
  if (error) throw new Error(`Belge kaydı saklanamadı: ${error.message}`);
}

async function loadById(id: string) {
  const storage = await bucket();
  const { data, error } = await storage.download(recordPath(id));
  if (error) {
    if (/not found|does not exist|404/i.test(error.message)) return null;
    throw new Error(`Belge kaydı okunamadı: ${error.message}`);
  }
  if (!data) return null;
  const record = JSON.parse(await data.text()) as TtaaQrRecord;
  if (record.id !== id || !record.details?.documentNumber) throw new Error("Belge kaydı bozuk.");
  return record;
}

export async function getTtaaQrRecord(number: string) { return loadById(recordId(number)); }

export async function createTtaaQrRecord(input: PrototypeDetails) {
  const details = validatePrototypeDetails(input);
  const id = recordId(details.documentNumber);
  if (await loadById(id)) throw new Error("Bu belge numarası zaten kayıtlı. Listeden mevcut kaydı açın.");
  const now = new Date().toISOString();
  const record: TtaaQrRecord = { id, details, createdAt: now, updatedAt: now };
  await save(record);
  return record;
}

export async function listTtaaQrRecords(query: string) {
  const storage = await bucket();
  const records: TtaaQrRecord[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.list(recordPrefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Belge listesi okunamadı: ${error.message}`);
    const files = (data || []).filter((item) => /^[a-f0-9]{64}\.json$/.test(item.name));
    for (let index = 0; index < files.length; index += 20) {
      const batch = await Promise.all(files.slice(index, index + 20).map((item) => loadById(item.name.slice(0, -5))));
      records.push(...batch.filter((item): item is TtaaQrRecord => Boolean(item)));
    }
    if ((data || []).length < 100) break;
  }
  const needle = query.trim().toLocaleLowerCase("tr-TR");
  return records.filter((item) => `${item.details.documentNumber} ${item.details.customer} ${item.details.documentType}`.toLocaleLowerCase("tr-TR").includes(needle)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function setTtaaQrPdf(number: string, file?: File) {
  const current = await getTtaaQrRecord(number);
  if (!current) throw new Error("Belge kaydı bulunamadı.");
  const storage = await bucket();
  if (!file) {
    if (!current.pdfPath) throw new Error("Bu kayıtta PDF yok.");
    const previousPath = current.pdfPath;
    const updated = { ...current, pdfPath: undefined, pdfName: undefined, updatedAt: new Date().toISOString() };
    await save(updated);
    const { error } = await storage.remove([previousPath]);
    return { record: updated, warning: error ? "PDF kayıttan kaldırıldı, ancak depodaki eski dosya silinemedi." : null };
  }
  if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024 || (file.type && !["application/pdf", "application/octet-stream"].includes(file.type))) throw new Error("En fazla 8 MB boyutunda bir PDF seçin.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Seçilen dosya geçerli bir PDF değil.");
  const path = `ttaa/pdfs/${current.id}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw new Error(`PDF yüklenemedi: ${uploadError.message}`);
  const updated = { ...current, pdfPath: path, pdfName: file.name.slice(0, 150), updatedAt: new Date().toISOString() };
  try { await save(updated); }
  catch (error) { await storage.remove([path]); throw error; }
  let warning: string | null = null;
  if (current.pdfPath) {
    const { error } = await storage.remove([current.pdfPath]);
    if (error) warning = "Yeni PDF kaydedildi, ancak eski dosya depodan silinemedi.";
  }
  return { record: updated, warning };
}

export async function loadTtaaQrPdf(number: string) {
  const record = await getTtaaQrRecord(number);
  if (!record?.pdfPath) return null;
  const { data, error } = await (await bucket()).download(record.pdfPath);
  if (error || !data) throw new Error(`PDF okunamadı: ${error?.message || "boş dosya"}`);
  return { bytes: await data.arrayBuffer(), name: record.pdfName || `${record.details.documentNumber}.pdf` };
}
