import { getSupabaseAdmin } from "./supabase";

export type VerificationPdfBrand = "ttaa" | "ay-tercume";

const BUCKET = "verification-pdfs-private";
const MAX_BYTES = 8 * 1024 * 1024;
let bucketReady: Promise<void> | undefined;

function validToken(token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Geçersiz doğrulama kimliği.");
}

function validKey(brand: VerificationPdfBrand, token: string, key: string) {
  validToken(token);
  if (!key.startsWith(`${brand}/${token}/`) || !/^[a-z0-9/-]+\.pdf$/.test(key)) throw new Error("Geçersiz özel PDF kaydı.");
}

async function storage() {
  if (!bucketReady) bucketReady = (async () => {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.storage.listBuckets();
    if (error) throw new Error(`Özel PDF deposu açılamadı: ${error.message}`);
    if (!data.some((item) => item.id === BUCKET || item.name === BUCKET)) {
      const { error: createError } = await admin.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: ["application/pdf"],
      });
      if (createError && !/already|exist|duplicate/i.test(createError.message)) throw new Error(`Özel PDF deposu oluşturulamadı: ${createError.message}`);
    }
  })();
  try { await bucketReady; }
  catch (error) { bucketReady = undefined; throw error; }
  return getSupabaseAdmin().storage.from(BUCKET);
}

export async function storeVerificationPdf(brand: VerificationPdfBrand, token: string, bytes: Uint8Array) {
  validToken(token);
  if (!bytes.length || bytes.length > MAX_BYTES || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("En fazla 8 MB boyutunda geçerli bir PDF yükleyin.");
  const key = `${brand}/${token}/${crypto.randomUUID()}.pdf`;
  const { error } = await (await storage()).upload(key, bytes, { contentType: "application/pdf", upsert: false, cacheControl: "0" });
  if (error) throw new Error(`PDF güvenli depoya yüklenemedi: ${error.message}`);
  return { key };
}

export async function loadVerificationPdf(brand: VerificationPdfBrand, token: string, key: string) {
  validKey(brand, token, key);
  const { data, error } = await (await storage()).download(key);
  if (error || !data) throw new Error(`PDF güvenli depodan okunamadı: ${error?.message || "boş dosya"}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Güvenli depodaki dosya geçerli bir PDF değil.");
  return bytes;
}

export async function deleteVerificationPdf(brand: VerificationPdfBrand, token: string, key: string) {
  validKey(brand, token, key);
  const { error } = await (await storage()).remove([key]);
  if (error) throw new Error(`PDF güvenli depodan silinemedi: ${error.message}`);
}

export async function importVerificationPdf(brand: VerificationPdfBrand, token: string, url: string) {
  const parsed = new URL(url);
  const hosts = brand === "ttaa" ? ["turkishtranslation.com.tr", "www.turkishtranslation.com.tr"] : ["aytercume.com", "www.aytercume.com"];
  if (parsed.protocol !== "https:" || !hosts.includes(parsed.hostname)) throw new Error("Eski PDF bağlantısı resmî şirket sitesinde değil.");
  const response = await fetch(parsed, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Eski PDF indirilemedi (${response.status}).`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_BYTES) throw new Error("Eski PDF 8 MB sınırını aşıyor.");
  return storeVerificationPdf(brand, token, new Uint8Array(await response.arrayBuffer()));
}
