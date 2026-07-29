import { parseResilientJson } from "./json";
import { integerEnv } from "./upstream";

export type ImageRole = "featured" | "inline";

export type ImageSuggestionInput = {
  placement?: string;
  altText?: string;
  imagePrompt?: string;
};

export type GeneratedImageBinary = {
  role: ImageRole;
  bytes: Uint8Array;
  fileName: string;
  contentType: "image/webp" | "image/jpeg" | "image/png";
  prompt: string;
  revisedPrompt?: string;
  alt: string;
  width: number;
  height: number;
  format: "webp" | "jpeg" | "png";
  model: string;
  quality: "low" | "medium" | "high";
  branding: { logoReferenceApplied: true; logoPlacement: "top-left"; headlineRequested: true; method: "gpt-image-2-edit" };
};

export type GenerateImagesInput = {
  title: string;
  slug: string;
  primaryPrompt: string;
  suggestions?: ImageSuggestionInput[];
  assetOrigin?: string;
};

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  error?: { message?: string; code?: string };
};

function imageConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing from .env.local.");
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
  const size = process.env.OPENAI_IMAGE_SIZE?.trim() || "1536x864";
  const quality = (process.env.OPENAI_IMAGE_QUALITY?.trim() || "medium") as "low" | "medium" | "high";
  const format = (process.env.OPENAI_IMAGE_FORMAT?.trim() || "webp") as "webp" | "jpeg" | "png";
  if (!/^(low|medium|high)$/.test(quality)) throw new Error("OPENAI_IMAGE_QUALITY must be low, medium or high.");
  if (!/^(webp|jpeg|png)$/.test(format)) throw new Error("OPENAI_IMAGE_FORMAT must be webp, jpeg or png.");
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw new Error("OPENAI_IMAGE_SIZE must use WIDTHxHEIGHT format.");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (width % 16 || height % 16 || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3 || pixels < 655_360 || pixels > 8_294_400) {
    throw new Error("OPENAI_IMAGE_SIZE does not meet GPT Image 2 size constraints.");
  }
  return { apiKey, model, size, quality, format, width, height };
}

function safeFilePart(value: string) {
  return value.toLowerCase().replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "ttaa-article";
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
  if (!match) throw new Error("The embedded TTAA logo asset is invalid.");
  return {
    bytes: decodeBase64(match[2]),
    fileName: "ttaa-brand-logo.png",
    contentType: match[1] || "image/png",
  };
}

async function resolveLogoAsset(assetOrigin?: string): Promise<LogoAsset> {
  if (assetOrigin) {
    const logoUrl = new URL("/ttaa-brand-logo.png", assetOrigin);
    const response = await fetch(logoUrl, { cache: "force-cache", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`The TTAA logo asset could not be loaded (${response.status}).`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      fileName: "ttaa-brand-logo.png",
      contentType: response.headers.get("content-type")?.split(";")[0] || "image/png",
    };
  }
  const assetModule = await import("../public/ttaa-brand-logo.png?inline");
  const embedded = embeddedLogoAsset(assetModule as unknown);
  if (embedded) return embedded;
  throw new Error("The TTAA logo asset origin is missing.");
}

function logoFile(asset: LogoAsset) {
  const buffer = new ArrayBuffer(asset.bytes.byteLength);
  new Uint8Array(buffer).set(asset.bytes);
  return new File([buffer], asset.fileName, { type: asset.contentType });
}

async function requestImage(prompt: string, logo: LogoAsset) {
  const config = imageConfig();
  let lastError = "OpenAI image generation failed.";
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
      signal: AbortSignal.timeout(integerEnv("OPENAI_IMAGE_TIMEOUT_MS", 240_000)),
    });
    const rawPayload = await response.text();
    let payload: OpenAIImageResponse;
    try {
      payload = parseResilientJson<OpenAIImageResponse>(rawPayload, "OpenAI image service");
    } catch (error) {
      lastError = error instanceof Error ? error.message : "OpenAI image service returned an unreadable response.";
      if (attempt < 2) {
        await wait(800 * 2 ** attempt);
        continue;
      }
      break;
    }
    if (response.ok && payload.data?.[0]?.b64_json) return { config, item: payload.data[0] };
    lastError = payload.error?.message || `OpenAI image generation failed (${response.status}).`;
    if (!(response.status === 429 || response.status >= 500) || attempt === 2) break;
    await wait(800 * 2 ** attempt);
  }
  throw new Error(lastError);
}

function topicVisualDirection(topic: string) {
  if (/\b(qvp|work visa|visa|immigration)\b/i.test(topic)) return "On the right, show a layered passport-sized travel document silhouette, supporting certificate sheets and a clear verification-path motif. Use only abstract, unreadable document surfaces and a subtle destination cue; never reproduce a real passport page or visa.";
  if (/\b(apostille|attestation|legalization|legalisation|notari[sz])\b/i.test(topic)) return "On the right, show layered certificates, authentication tabs, a notarial document folder and an abstract approval-path motif. Suggest formal processing without copying a real apostille, seal, stamp or government emblem.";
  if (/\b(translation|translator|interpreting|language)\b/i.test(topic)) return "On the right, show a polished bilingual document cluster, certificate sheets, language-direction arrows and careful review details. Emphasize accurate professional translation rather than generic office work.";
  return "On the right, show a polished, topic-specific international document-support cluster with layered papers, verification cues and a clear professional workflow.";
}

function protectedPrompt(topic: string, role: ImageRole, sourcePrompt: string) {
  const composition = role === "featured"
    ? "Create a premium 16:9 TTAA website featured banner with a left-text and right-visual composition."
    : "Create a distinct supporting 16:9 TTAA article banner with a left-text and right-visual composition; explain the most useful document workflow for this exact topic without repeating the featured composition.";
  return `Use case: ads-marketing\nAsset type: TTAA professional website and blog banner\nPrimary topic: ${topic}\n${composition}\nInput image: the supplied image is the exact TTAA brand logo. Preserve its spelling, proportions, globe symbol, arrows and blue/navy colors. Place it unchanged in the top-left with clear padding and no distortion.\nText (verbatim): "${topic}". Place this exact headline as large, bold, highly legible navy typography on the left below the logo. Do not misspell, paraphrase or add another headline.\nTopic-specific creative direction: ${sourcePrompt}\n${topicVisualDirection(topic)}\nBrand style: clean modern corporate white background, TTAA blue and navy gradients, soft light-grey details, trustworthy premium document-service aesthetic. Add a subtle dotted world map and restrained flowing blue gradient ribbons or wave curves for an international feel. Use realistic depth and soft shadows while keeping the arrangement uncluttered.\nComposition rules: no people, no generic office scene, no unrelated business meeting, no random laptop hero shot. Keep the left headline clear and the right document cluster specific to the named service.\nSafety constraints: no readable personal information, no copied identity document, no fake government seal or emblem, no fabricated official stamp, no claim of guaranteed approval, no imitation of a government website. Abstract document surfaces may use lines and shapes only. No additional logo, watermark, paragraph or tiny unreadable text. 16:9 landscape, modern premium website-banner quality.`;
}

async function generateOne(input: GenerateImagesInput, logo: LogoAsset, role: ImageRole, suggestion?: ImageSuggestionInput): Promise<GeneratedImageBinary> {
  const sourcePrompt = suggestion?.imagePrompt?.trim() || (role === "featured"
    ? input.primaryPrompt
    : `A professional close-up workflow scene showing careful multilingual document review, terminology checking and secure digital delivery for ${input.title}.`);
  const prompt = protectedPrompt(input.title, role, sourcePrompt);
  const { config, item } = await requestImage(prompt, logo);
  const extension = config.format === "jpeg" ? "jpg" : config.format;
  const contentType = config.format === "jpeg" ? "image/jpeg" : config.format === "png" ? "image/png" : "image/webp";
  const defaultAlt = role === "featured" ? `${input.title} professional document service` : `${input.title} document review workflow`;
  return {
    role,
    bytes: decodeBase64(item.b64_json || ""),
    fileName: `${safeFilePart(input.slug)}-${role}.${extension}`,
    contentType,
    prompt,
    revisedPrompt: item.revised_prompt,
    alt: (suggestion?.altText?.trim() || defaultAlt).slice(0, 180),
    width: config.width,
    height: config.height,
    format: config.format,
    model: config.model,
    quality: config.quality,
    branding: { logoReferenceApplied: true, logoPlacement: "top-left", headlineRequested: true, method: "gpt-image-2-edit" },
  };
}

export async function generateBlogImages(input: GenerateImagesInput) {
  const logo = await resolveLogoAsset(input.assetOrigin);
  const featuredSuggestion = input.suggestions?.[0];
  const inlineSuggestion = input.suggestions?.[1];
  const [featured, inline] = await Promise.all([
    generateOne(input, logo, "featured", featuredSuggestion),
    generateOne(input, logo, "inline", inlineSuggestion),
  ]);
  return { featured, inline };
}

export async function generateBlogImage(input: GenerateImagesInput, role: ImageRole) {
  const logo = await resolveLogoAsset(input.assetOrigin);
  return generateOne(input, logo, role, input.suggestions?.[role === "featured" ? 0 : 1]);
}

export async function verifyOpenAIImageConnection() {
  const { apiKey, model, size, quality, format } = imageConfig();
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = parseResilientJson<{ id?: string; error?: { message?: string } }>(await response.text(), "OpenAI image model check");
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI image model check failed (${response.status}).`);
  return { connected: true, model: payload.id || model, size, quality, format };
}
