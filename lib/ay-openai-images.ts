import ayLogoDataUrl from "../public/ay-tercume-logo.jpg?inline";
import { parseResilientJson } from "./json";

export type AyImageRole = "featured" | "inline";

export type AyImageSuggestionInput = {
  placement?: string;
  altText?: string;
  imagePrompt?: string;
  titleText?: string;
  caption?: string;
  description?: string;
};

export type AyGeneratedImageBinary = {
  role: AyImageRole;
  bytes: Uint8Array;
  fileName: string;
  contentType: "image/webp" | "image/jpeg" | "image/png";
  prompt: string;
  revisedPrompt?: string;
  alt: string;
  titleText: string;
  caption: string;
  description: string;
  width: number;
  height: number;
  format: "webp" | "jpeg" | "png";
  model: string;
  quality: "low" | "medium" | "high";
  branding: {
    brand: "ay-tercume";
    logoReferenceApplied: true;
    logoPlacement: "top-left";
    headlineRequested: true;
    method: "gpt-image-2-edit";
  };
};

type GenerateAyImagesInput = {
  title: string;
  slug: string;
  primaryPrompt: string;
  suggestions?: AyImageSuggestionInput[];
  assetOrigin?: string;
};

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  error?: { message?: string; code?: string };
};

function imageConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY .env.local dosyasında bulunamadı.");
  const model = process.env.AY_OPENAI_IMAGE_MODEL?.trim() || process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
  const size = process.env.AY_OPENAI_IMAGE_SIZE?.trim() || process.env.OPENAI_IMAGE_SIZE?.trim() || "1536x864";
  const quality = (process.env.AY_OPENAI_IMAGE_QUALITY?.trim() || process.env.OPENAI_IMAGE_QUALITY?.trim() || "medium") as "low" | "medium" | "high";
  const format = (process.env.AY_OPENAI_IMAGE_FORMAT?.trim() || process.env.OPENAI_IMAGE_FORMAT?.trim() || "webp") as "webp" | "jpeg" | "png";
  if (!/^(low|medium|high)$/.test(quality)) throw new Error("AY_OPENAI_IMAGE_QUALITY low, medium veya high olmalıdır.");
  if (!/^(webp|jpeg|png)$/.test(format)) throw new Error("AY_OPENAI_IMAGE_FORMAT webp, jpeg veya png olmalıdır.");
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw new Error("AY_OPENAI_IMAGE_SIZE WIDTHxHEIGHT biçiminde olmalıdır.");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (width % 16 || height % 16 || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3 || pixels < 655_360 || pixels > 8_294_400) {
    throw new Error("AY_OPENAI_IMAGE_SIZE GPT Image 2 boyut sınırlarına uymuyor.");
  }
  return { apiKey, model, size, quality, format, width, height };
}

function safeFilePart(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/^\/+|\/+$/g, "").replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i").replace(/[öÖ]/g, "o").replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 76) || "ay-tercume-icerik";
}

function shortHeadline(value: string) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let result = "";
  for (const word of words.slice(0, 11)) {
    const candidate = result ? `${result} ${word}` : word;
    if (candidate.length > 72) break;
    result = candidate;
  }
  return result || "Profesyonel Tercüme Hizmeti";
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type LogoAsset = {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
};

function importedAssetValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as { src?: unknown; default?: unknown };
  if (typeof record.src === "string") return record.src;
  return record.default === value ? null : importedAssetValue(record.default);
}

function embeddedLogoAsset(value: unknown): LogoAsset | null {
  const source = importedAssetValue(value);
  if (!source?.startsWith("data:")) return null;
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(source);
  if (!match) throw new Error("Ay Tercüme logo dosyası okunamadı.");
  return {
    bytes: decodeBase64(match[2]),
    fileName: "ay-tercume-logo.jpg",
    contentType: match[1] || "image/jpeg",
  };
}

async function resolveLogoAsset(assetOrigin?: string): Promise<LogoAsset> {
  const embedded = embeddedLogoAsset(ayLogoDataUrl as unknown);
  if (embedded) return embedded;
  if (!assetOrigin) throw new Error("Ay Tercüme logo adresi bulunamadı.");

  const logoUrl = new URL("/ay-tercume-logo.jpg", assetOrigin);
  const response = await fetch(logoUrl, { cache: "force-cache", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Ay Tercüme logo dosyası yüklenemedi (${response.status}).`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    fileName: "ay-tercume-logo.jpg",
    contentType: response.headers.get("content-type")?.split(";")[0] || "image/jpeg",
  };
}

function logoFile(asset: LogoAsset) {
  const buffer = new ArrayBuffer(asset.bytes.byteLength);
  new Uint8Array(buffer).set(asset.bytes);
  return new File([buffer], asset.fileName, { type: asset.contentType });
}

function topicVisualDirection(topic: string) {
  if (/\b(apostil|apostille|tasdik|legalizasyon|legalization|noter|notari)/i.test(topic)) return "Sağ tarafta katmanlı sertifikalar, noter klasörü, doğrulama adımları ve soyut bir onay yolu göster. Gerçek apostil, mühür, resmî amblem veya kurum belgesi kopyalama.";
  if (/\b(vize|visa|göç|goc|oturum|ikamet|çalışma izni|calisma izni)/i.test(topic)) return "Sağ tarafta soyut seyahat belgesi silüetleri, destekleyici sertifikalar ve açık bir başvuru akışı göster. Gerçek pasaport veya vize sayfası üretme.";
  if (/\b(diploma|transkript|akademik|üniversite|universite|eğitim|egitim)/i.test(topic)) return "Sağ tarafta diploma, transkript, akademik dosya ve kontrollü belge inceleme düzeni göster; hiçbir gerçek okul logosu veya kişisel bilgi kullanma.";
  if (/\b(hukuk|hukuki|legal|sözleşme|sozlesme|mahkeme|vekalet)/i.test(topic)) return "Sağ tarafta sözleşme sayfaları, hukuk dosyası ve terminoloji kontrolü ayrıntıları göster; mahkeme amblemi, gerçek imza veya resmî mühür kullanma.";
  if (/\b(tıbbi|tibbi|medikal|medical|sağlık|saglik|rapor)/i.test(topic)) return "Sağ tarafta anonim tıbbi raporlar, terminoloji notları ve güvenli belge işleme akışı göster; hasta bilgisi veya yanıltıcı sağlık sembolü kullanma.";
  if (/\b(teknik|technical|mühendis|muhendis|kılavuz|kilavuz|manual)/i.test(topic)) return "Sağ tarafta teknik kılavuzlar, şema çizgileri, terminoloji kontrol listesi ve düzenli dosya katmanları göster.";
  if (/\b(sözlü|sozlu|tercüman|tercuman|interpreting|simultane|ardıl|ardil)/i.test(topic)) return "Sağ tarafta soyut konuşma dalgaları, iki dilli iletişim yönleri ve profesyonel toplantı akışı göster; kalabalık stok toplantı sahnesi kullanma.";
  return "Sağ tarafta konuya özel iki dilli belge kümesi, dikkatli kontrol işaretleri, dil yönü okları ve profesyonel teslim akışı göster.";
}

function protectedPrompt(topic: string, role: AyImageRole, sourcePrompt: string, requestedHeadline: string) {
  const composition = role === "featured"
    ? "Ay Tercüme web sitesi için premium 16:9 featured banner oluştur. Solda marka ve başlık, sağda konuya özgü belge kompozisyonu kullan."
    : "Ay Tercüme makalesi için featured görselden belirgin biçimde farklı, açıklayıcı 16:9 içerik bannerı oluştur. Solda marka ve kısa başlık, sağda bu konunun en yararlı süreç görselleştirmesini kullan.";
  return `Kullanım alanı: profesyonel tercüme ve belge hizmetleri\nMarka: Ay Tercüme\nAna konu: ${topic}\n${composition}\nGirdi görseli, kullanıcı tarafından sağlanan gerçek Ay Tercüme logosudur. Logodaki AY TERCÜME yazısını, dairesel okları, konuşan profil simgesini, şirket alt satırını, oranları ve siyah-mavi renkleri değiştirmeden koru. Logoyu sol üst köşeye, güvenli boşluk içinde, küçük fakat net ve okunaklı yerleştir. Logoyu yeniden çizme, kısaltma veya başka bir işaretle değiştirme.\nGörsel üzerindeki ana başlık (harfiyen): "${requestedHeadline}". Bu kısa başlığı logonun altında/sol orta alanda büyük, koyu, yüksek kontrastlı ve kolay okunur biçimde göster. Başka başlık, paragraf veya rastgele yazı ekleme.\nKonuya özel brief: ${sourcePrompt}\n${topicVisualDirection(topic)}\nAy Tercüme görsel dili: beyaz ana arka plan (#ffffff), ana turkuaz/mint (#43cc9b), vurgu mavisi (#009fe4), siyaha yakın koyu yazı (#0f0b08). Yumuşak mint-mavi geçişler, hafif dünya/iletişim motifleri, temiz katmanlar ve ölçülü gölgeler kullan. Tasarım ferah, güvenilir, çağdaş ve kurumsal olsun.\nKompozisyon: jenerik stok fotoğraf, kalabalık insan grubu, ilgisiz ofis/laptop sahnesi ve koyu ağır arka plan kullanma. Sağdaki nesneler doğrudan konuya hizmet etsin. Metin ve logo çevresinde geniş negatif alan bırak.\nGüvenlik: okunabilir kişisel bilgi, gerçek kimlik belgesi, sahte devlet mührü, kurum arması, resmî damga, gerçek imza, yanıltıcı logo veya garanti vaadi üretme. Belge yüzeylerinde yalnızca soyut çizgi ve şekiller kullan. Ek logo, watermark, küçük anlamsız metin veya fiyat etiketi ekleme. 16:9 yatay, modern ve yüksek kaliteli web bannerı.`;
}

async function requestImage(prompt: string, logo: LogoAsset) {
  const config = imageConfig();
  let lastError = "OpenAI görsel üretimi başarısız oldu.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const form = new FormData();
    form.append("model", config.model);
    form.append("prompt", prompt);
    form.append("image[]", logoFile(logo));
    form.append("n", "1");
    form.append("size", config.size);
    form.append("quality", config.quality);
    form.append("output_format", config.format);
    form.append("background", "opaque");
    form.append("moderation", "auto");
    if (config.format !== "png") form.append("output_compression", "82");
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
    const rawPayload = await response.text();
    let payload: OpenAIImageResponse;
    try {
      payload = parseResilientJson<OpenAIImageResponse>(rawPayload, "Ay Tercüme görsel servisi");
    } catch (error) {
      lastError = error instanceof Error ? error.message : "OpenAI görsel servisi okunamayan yanıt döndürdü.";
      if (attempt < 2) {
        await wait(800 * 2 ** attempt);
        continue;
      }
      break;
    }
    if (response.ok && payload.data?.[0]?.b64_json) return { config, item: payload.data[0] };
    lastError = payload.error?.message || `OpenAI görsel üretimi başarısız oldu (${response.status}).`;
    if (!(response.status === 429 || response.status >= 500) || attempt === 2) break;
    await wait(800 * 2 ** attempt);
  }
  throw new Error(lastError);
}

async function generateOne(input: GenerateAyImagesInput, logo: LogoAsset, role: AyImageRole, suggestion?: AyImageSuggestionInput): Promise<AyGeneratedImageBinary> {
  const titleText = shortHeadline(suggestion?.titleText?.trim() || input.title);
  const sourcePrompt = suggestion?.imagePrompt?.trim() || (role === "featured"
    ? input.primaryPrompt
    : `${input.title} konusu için belge hazırlama, terminoloji kontrolü ve güvenli teslim adımlarını gösteren kurumsal süreç görseli.`);
  const prompt = protectedPrompt(input.title, role, sourcePrompt, titleText);
  const { config, item } = await requestImage(prompt, logo);
  const extension = config.format === "jpeg" ? "jpg" : config.format;
  const contentType = config.format === "jpeg" ? "image/jpeg" : config.format === "png" ? "image/png" : "image/webp";
  const defaultAlt = role === "featured" ? `${input.title} için Ay Tercüme hizmet görseli` : `${input.title} belge hazırlama ve kontrol süreci`;
  const alt = (suggestion?.altText?.trim() || defaultAlt).slice(0, 180);
  return {
    role,
    bytes: decodeBase64(item.b64_json || ""),
    fileName: `${safeFilePart(input.slug)}-${role}.${extension}`,
    contentType,
    prompt,
    revisedPrompt: item.revised_prompt,
    alt,
    titleText,
    caption: (suggestion?.caption?.trim() || alt).slice(0, 220),
    description: (suggestion?.description?.trim() || `${input.title} için Ay Tercüme tarafından hazırlanan konuya özel kurumsal görsel.`).slice(0, 500),
    width: config.width,
    height: config.height,
    format: config.format,
    model: config.model,
    quality: config.quality,
    branding: { brand: "ay-tercume", logoReferenceApplied: true, logoPlacement: "top-left", headlineRequested: true, method: "gpt-image-2-edit" },
  };
}

export async function generateAyBlogImages(input: GenerateAyImagesInput) {
  const logo = await resolveLogoAsset(input.assetOrigin);
  const [featured, inline] = await Promise.all([
    generateOne(input, logo, "featured", input.suggestions?.[0]),
    generateOne(input, logo, "inline", input.suggestions?.[1]),
  ]);
  return { featured, inline };
}

export async function verifyAyOpenAIImageConnection() {
  const { apiKey, model, size, quality, format } = imageConfig();
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = parseResilientJson<{ id?: string; error?: { message?: string } }>(await response.text(), "Ay Tercüme görsel model kontrolü");
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI görsel model kontrolü başarısız oldu (${response.status}).`);
  return { connected: true, model: payload.id || model, size, quality, format };
}
