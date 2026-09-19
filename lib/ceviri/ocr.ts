/**
 * Belge AI / OCR sağlayıcısı, adaptörün arkasında (spec 6.5).
 *
 * Sağlayıcı seçimi Faz 1'e bırakıldı ve henüz bir hesap açılmadı, bu yüzden
 * burada yalnızca arayüz ve bir DEMO sağlayıcı var. Demo sağlayıcı GERÇEK OCR
 * YAPMAZ — belgeden metin çıkarmaz, uydurmaz, tahmin etmez. Yalnızca "bu
 * sayfada OCR yapılamadı" diyen yer tutucu segmentler döner, böylece akışın
 * geri kalanı (segmentasyon, inceleme ekranı, DOCX üretimi) uçtan uca
 * denenebilir ve hiç kimse uydurulmuş metni gerçek sanmaz.
 *
 * Gerçek sağlayıcı bağlandığında yalnızca bu dosyadaki adaptör değişir.
 */

export type OcrBlock = {
  kind: "heading" | "paragraph" | "table-cell";
  text: string;
  page: number;
  /** 0-1 arası; düşük değerler inceleme ekranında işaretlenir. */
  confidence: number;
  row?: number;
  column?: number;
};

export type OcrResult = {
  provider: string;
  /** true ise içerik gerçek değildir, yalnızca akışı denemek içindir. */
  demo: boolean;
  /** Belirlenemediyse null — uydurulmuş bir sayı dönülmez. */
  pages: number | null;
  blocks: OcrBlock[];
  warning: string | null;
};

export type OcrProvider = {
  id: string;
  label: string;
  configured: boolean;
  /** Sayfa başına yaklaşık maliyet, USD. Bilinmiyorsa null. */
  pricePerPage: number | null;
  run(bytes: Uint8Array, options: { lang: string }): Promise<OcrResult>;
};

/**
 * PDF sayfa sayısı — bilinemiyorsa null.
 *
 * Ham metin içinde `/Type /Page` aramak yalnızca nesneler sıkıştırılmamışsa
 * çalışır. Müşterinin taranmış PDF'lerinde nesne akışları sıkıştırıldığı için
 * bu yöntem hiç eşleşme bulmaz. Ölçtüm: aynı 84 dosyada bu yöntem 91 sayfa
 * derken gerçek sayı 188'di. O yüzden eşleşme yoksa "1" uydurmak yerine null
 * dönüyor; çağıran taraf sayıyı bilmediğini söylemeli.
 */
export function countPdfPages(bytes: Uint8Array): number | null {
  let text = "";
  const chunk = 65536;
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches && matches.length > 0 ? matches.length : null;
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

const DEMO_PROVIDER: OcrProvider = {
  id: "demo",
  label: "Demo (OCR bağlı değil)",
  configured: false,
  pricePerPage: null,
  async run(bytes) {
    const pages = countPdfPages(bytes);
    const placeholders = pages ?? 1;
    const pageNote = pages === null
      ? " Sayfa sayısı da belirlenemedi (PDF nesneleri sıkıştırılmış)."
      : "";
    return {
      provider: "demo",
      demo: true,
      pages,
      blocks: Array.from({ length: placeholders }, (_, index) => ({
        kind: "paragraph" as const,
        text: pages === null
          ? "[OCR servisi bağlı değil — bu belgenin metni okunamadı]"
          : `[Sayfa ${index + 1} — OCR servisi bağlı değil, bu sayfanın metni okunamadı]`,
        page: index + 1,
        confidence: 0,
      })),
      warning:
        "OCR servisi yapılandırılmamış. Bu belgeden metin ÇIKARILMADI — aşağıdaki satırlar yalnızca yer tutucudur, çeviri değildir." +
        pageNote +
        " Gerçek çeviri için bir Belge AI sağlayıcısı bağlanmalıdır.",
    };
  },
};

/**
 * Azure Document Intelligence (Layout) — $10/1.000 sayfa.
 * Anahtar tanımlıysa kullanılır. Uygulaması bilinçli olarak boş: hesap
 * açıldığında burası doldurulacak, başka hiçbir yer değişmeyecek.
 */
const AZURE_PROVIDER: OcrProvider = {
  id: "azure",
  label: "Azure Document Intelligence (Layout)",
  configured: Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim()),
  pricePerPage: 0.01,
  async run() {
    throw new Error(
      "Azure Document Intelligence adaptörü henüz uygulanmadı. AZURE_DOCUMENT_INTELLIGENCE_KEY ve _ENDPOINT tanımlandıktan sonra lib/ceviri/ocr.ts içinde doldurulacak.",
    );
  },
};

/** Mistral OCR — $2/1.000 sayfa. Aynı şekilde bekliyor. */
const MISTRAL_PROVIDER: OcrProvider = {
  id: "mistral",
  label: "Mistral OCR",
  configured: Boolean(process.env.MISTRAL_API_KEY?.trim()),
  pricePerPage: 0.002,
  async run() {
    throw new Error(
      "Mistral OCR adaptörü henüz uygulanmadı. MISTRAL_API_KEY tanımlandıktan sonra lib/ceviri/ocr.ts içinde doldurulacak.",
    );
  },
};

export const OCR_PROVIDERS: OcrProvider[] = [AZURE_PROVIDER, MISTRAL_PROVIDER, DEMO_PROVIDER];

/** Yapılandırılmış ilk sağlayıcıyı, yoksa demo sağlayıcıyı döner. */
export function activeOcrProvider(): OcrProvider {
  return OCR_PROVIDERS.find((provider) => provider.configured) ?? DEMO_PROVIDER;
}

export function ocrToSegments(result: OcrResult): Array<{
  id: string;
  text: string;
  kind: "paragraph" | "table-cell";
  order: number;
  confidence: number;
}> {
  return result.blocks.map((block, index) => ({
    id: `o${index + 1}`,
    text: block.text,
    kind: block.kind === "table-cell" ? "table-cell" : "paragraph",
    order: index + 1,
    confidence: block.confidence,
  }));
}
