import { fetchWithRetry, integerEnv } from "../upstream";
import { classifyImage } from "./image-kind";
import {
  imageKey,
  layoutFromMistral,
  layoutSegments,
  type ImageInsight,
  type ImageKind,
  type LayoutBlock,
  type MistralResponse,
} from "./ocr-layout";

/**
 * Belge AI / OCR sağlayıcısı, adaptörün arkasında (spec 6.5).
 *
 * Mistral OCR gerçek ve çalışıyor. Azure adaptörü tanımlı ama boş. Hiçbir
 * sağlayıcı yapılandırılmamışsa DEMO sağlayıcı devreye girer ve GERÇEK OCR
 * YAPMAZ — metin çıkarmaz, uydurmaz; yalnızca "okunamadı" diyen yer tutucular
 * döner ki akışın geri kalanı denenebilsin ve kimse uydurma metni gerçek sanmasın.
 */

export type OcrResult = {
  provider: string;
  /** true ise içerik gerçek değildir, yalnızca akışı denemek içindir. */
  demo: boolean;
  /** Belirlenemediyse null — uydurulmuş bir sayı dönülmez. */
  pages: number | null;
  blocks: LayoutBlock[];
  warning: string | null;
};

export type OcrProvider = {
  id: string;
  label: string;
  readonly configured: boolean;
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

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
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
        role: "text" as const,
        page: index + 1,
        lines: [
          {
            id: `o${index + 1}`,
            text: pages === null
              ? "[OCR servisi bağlı değil — bu belgenin metni okunamadı]"
              : `[Sayfa ${index + 1} — OCR servisi bağlı değil, bu sayfanın metni okunamadı]`,
            confidence: 0,
            ocrWarning: null,
          },
        ],
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
 * Uygulaması bilinçli olarak boş: hesap açılırsa yalnızca burası doldurulur.
 */
const AZURE_PROVIDER: OcrProvider = {
  id: "azure",
  label: "Azure Document Intelligence (Layout)",
  get configured() {
    return Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim());
  },
  pricePerPage: 0.01,
  async run() {
    throw new Error(
      "Azure Document Intelligence adaptörü henüz uygulanmadı. AZURE_DOCUMENT_INTELLIGENCE_KEY ve _ENDPOINT tanımlandıktan sonra lib/ceviri/ocr.ts içinde doldurulacak.",
    );
  },
};

// ---------- Mistral ----------

const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";

async function mistralOcr(document: Record<string, string>, extra: Record<string, unknown>) {
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) throw new Error("MISTRAL_API_KEY sunucu ortamında tanımlı değil.");

  const response = await fetchWithRetry(
    MISTRAL_OCR_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.MISTRAL_OCR_MODEL?.trim() || "mistral-ocr-latest",
        document,
        include_blocks: true,
        confidence_scores_granularity: "block",
        ...extra,
      }),
      cache: "no-store",
    },
    {
      upstream: "Mistral OCR",
      timeoutMs: integerEnv("MISTRAL_OCR_TIMEOUT_MS", 180_000),
      maxAttempts: 3,
      // OCR isteği yan etkisizdir; aynı belgeyi yeniden okutmak güvenli.
      retryUnsafe: true,
    },
  );

  const body = (await response.json().catch(() => ({}))) as MistralResponse & { message?: string };
  if (response.status === 401) throw new Error("Mistral OCR anahtarı geçersiz.");
  if (response.status === 429) {
    throw new Error("Mistral OCR istek sınırına takıldı veya hesap bakiyesi yok. Biraz sonra tekrar deneyin.");
  }
  if (!response.ok) throw new Error(body.message ?? `Mistral OCR HTTP ${response.status}`);
  return body;
}

function asDataUrl(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/jpeg;base64,${base64}`;
}

/** İmza ve mühür alanlarının yanında basılı metin olabilir: imzacının adı, unvanı. */
const READ_TEXT_INSIDE: ReadonlySet<ImageKind> = new Set(["signature", "stamp", "signature_stamp"]);

/**
 * Görselin türü ve içindeki basılı yazı. Yazı okunamazsa tür yine döner:
 * imza/mühür etiketi yazının okunmasına bağlı değildir.
 */
export async function inspectImage(dataUrl: string): Promise<ImageInsight> {
  const kind = await classifyImage(dataUrl, process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23");
  if (!READ_TEXT_INSIDE.has(kind)) return { kind, lines: [] };

  let body: MistralResponse;
  try {
    body = await mistralOcr({ type: "image_url", image_url: dataUrl }, {});
  } catch {
    return { kind, lines: [] };
  }
  const lines = (body.pages ?? []).flatMap((page) =>
    (page.blocks ?? [])
      .filter((block) => block.type !== "image" && block.content?.trim())
      .map((block) => ({
        text: String(block.content),
        confidence: block.confidence_scores?.minimum_content_confidence_score ?? null,
      })),
  );
  return { kind, lines };
}

const MISTRAL_PROVIDER: OcrProvider = {
  id: "mistral",
  label: "Mistral OCR",
  get configured() {
    return Boolean(process.env.MISTRAL_API_KEY?.trim());
  },
  pricePerPage: 0.002,
  async run(bytes) {
    const body = await mistralOcr(
      { type: "document_url", document_url: `data:application/pdf;base64,${toBase64(bytes)}` },
      {
        table_format: "html",
        extract_header: true,
        extract_footer: true,
        include_image_base64: true,
      },
    );

    // Her görsel ikinci kez incelenir: türü (imza/mühür/logo...) ve içindeki
    // basılı metin. Ölçüm: DELAN SC belgesinde ikinci imzacının adı ve unvanı
    // mühürle birlikte tek bir görsele gömülmüştü; ilk geçiş onu hiç okumadı.
    const jobs: Array<Promise<[string, ImageInsight]>> = [];
    for (const page of body.pages ?? []) {
      for (const block of page.blocks ?? []) {
        if (block.type !== "image") continue;
        const id = /\(([^)]+)\)/.exec(block.content ?? "")?.[1];
        const image = id ? page.images?.find((candidate) => candidate.id === id) : undefined;
        if (!id || !image?.image_base64) continue;
        const key = imageKey(page.index, id);
        jobs.push(
          inspectImage(asDataUrl(image.image_base64))
            .then((insight): [string, ImageInsight] => [key, insight])
            .catch((): [string, ImageInsight] => [key, { kind: "unknown", lines: [] }]),
        );
      }
    }
    const insights = new Map(await Promise.all(jobs));
    const blocks = layoutFromMistral(body, insights);
    const unknown = [...insights.values()].filter((insight) => insight.kind === "unknown").length;

    return {
      provider: "mistral",
      demo: false,
      pages: body.pages?.length ?? null,
      blocks,
      // Görsellerin kendisine hiç dokunulmaz; tür bilinmezse yalnızca içindeki
      // basılı yazı (varsa) okunmamış olur.
      warning: unknown
        ? `${unknown} görselin türü belirlenemedi. Görsel olduğu gibi kalır, ama içinde basılı yazı varsa (imzacı adı gibi) okunmamış olabilir.`
        : null,
    };
  },
};

export const OCR_PROVIDERS: OcrProvider[] = [AZURE_PROVIDER, MISTRAL_PROVIDER, DEMO_PROVIDER];

/** Yapılandırılmış ilk sağlayıcıyı, yoksa demo sağlayıcıyı döner. */
export function activeOcrProvider(): OcrProvider {
  return OCR_PROVIDERS.find((provider) => provider.configured) ?? DEMO_PROVIDER;
}

export function ocrToSegments(result: OcrResult) {
  return layoutSegments(result.blocks);
}
