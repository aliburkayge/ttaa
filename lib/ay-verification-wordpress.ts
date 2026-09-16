import { AY_VERIFICATION_LANDING_SLUG, ayVerificationDocumentHtml, ayVerificationLandingHtml, ayVerificationSeo, readAyVerificationDocument, type AyVerificationDocument } from "./ay-verification-page";

type WpPage = {
  id: number;
  slug: string;
  status: string;
  link: string;
  template?: string;
  content?: { raw?: string; rendered?: string };
  message?: string;
};

const VERIFICATION_TEMPLATE = "elementor_header_footer";

function config() {
  const baseUrl = process.env.AY_WP_URL?.replace(/\/+$/, "");
  const username = process.env.AY_WP_USERNAME;
  const password = process.env.AY_WP_APP_PASSWORD;
  if (!baseUrl || !username || !password) throw new Error("Ay Tercüme WordPress API bilgileri eksik.");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || !["aytercume.com", "www.aytercume.com"].includes(url.hostname)) throw new Error("Ay Tercüme WordPress adresi aytercume.com olmalıdır.");
  return { baseUrl, authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

async function wpJson<T>(url: string, authorization: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: authorization, Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let value: T & { message?: string };
  try { value = JSON.parse(raw) as T & { message?: string }; }
  catch { throw new Error(`Ay Tercüme WordPress API geçersiz yanıt verdi (${response.status}).`); }
  if (!response.ok) throw new Error(value.message || `Ay Tercüme WordPress API hatası (${response.status}).`);
  return value;
}

async function pagesBySlug(baseUrl: string, authorization: string, slug: string) {
  const params = new URLSearchParams({ context: "edit", slug, per_page: "5", _fields: "id,slug,status,link,content,template" });
  return wpJson<WpPage[]>(`${baseUrl}/wp-json/wp/v2/pages?${params}`, authorization);
}

async function pageById(baseUrl: string, authorization: string, id: number) {
  return wpJson<WpPage>(`${baseUrl}/wp-json/wp/v2/pages/${id}?context=edit&_fields=id,slug,status,link,content,template`, authorization);
}

async function savePage(baseUrl: string, authorization: string, data: Record<string, unknown>, id?: number) {
  return wpJson<WpPage>(`${baseUrl}/wp-json/wp/v2/pages${id ? `/${id}` : ""}`, authorization, { method: "POST", body: JSON.stringify(data) });
}

async function saveSeo(baseUrl: string, authorization: string, pageId: number, seo: { title: string; description: string }, noindex: boolean) {
  const result = await wpJson<{ success?: boolean; message?: string }>(`${baseUrl}/wp-json/rankmath/v1/updateMeta`, authorization, {
    method: "POST",
    body: JSON.stringify({
      objectType: "post",
      objectID: pageId,
      meta: {
        rank_math_title: seo.title,
        rank_math_description: seo.description,
        ...(noindex ? { rank_math_robots: ["noindex", "follow"] } : {}),
      },
    }),
  });
  if (result.success === false) throw new Error(result.message || "Rank Math SEO bilgileri kaydedilemedi.");
}

async function ensurePage(input: { slug: string; title: string; content: string; marker: string; seo: { title: string; description: string }; noindex: boolean; hasFile?: boolean; refreshPublished?: boolean }) {
  const { baseUrl, authorization } = config();
  const matches = await pagesBySlug(baseUrl, authorization, input.slug);
  const existing = matches.find((page) => page.slug === input.slug);
  if (existing && !existing.content?.raw?.includes(input.marker)) throw new Error("Aynı adreste farklı bir WordPress sayfası mevcut; üzerine yazılmadı.");
  if (existing?.status === "publish" && !input.refreshPublished) return { id: existing.id, url: existing.link, reused: true };
  if (existing?.status === "publish") {
    await savePage(baseUrl, authorization, { title: input.title, content: input.content, excerpt: input.seo.description, template: VERIFICATION_TEMPLATE }, existing.id);
    const saved = await pageById(baseUrl, authorization, existing.id);
    if (!saved.content?.raw?.includes(input.marker)) throw new Error("WordPress doğrulama sayfası işaretini saklamadı.");
    if (saved.template !== VERIFICATION_TEMPLATE) throw new Error("WordPress tam genişlik sayfa şablonunu kaydetmedi.");
    await saveSeo(baseUrl, authorization, existing.id, input.seo, input.noindex);
    return { id: existing.id, url: existing.link, reused: true };
  }
  const draft = existing || await savePage(baseUrl, authorization, {
    title: input.title,
    content: input.content,
    excerpt: input.seo.description,
    slug: input.slug,
    status: "draft",
    template: VERIFICATION_TEMPLATE,
    comment_status: "closed",
    ping_status: "closed",
  });
  if (draft.slug !== input.slug || draft.status !== "draft") throw new Error("WordPress beklenen sayfa taslağını oluşturmadı.");
  if (existing) await savePage(baseUrl, authorization, { title: input.title, content: input.content, excerpt: input.seo.description, template: VERIFICATION_TEMPLATE }, draft.id);
  const saved = await pageById(baseUrl, authorization, draft.id);
  if (!saved.content?.raw?.includes(input.marker)) throw new Error("WordPress doğrulama sayfası işaretini saklamadı; taslak yayımlanmadı.");
  if (saved.template !== VERIFICATION_TEMPLATE) throw new Error("WordPress tam genişlik sayfa şablonunu kaydetmedi; taslak yayımlanmadı.");
  if (input.noindex && (!saved.content.raw.includes("ayv-file") || Boolean(saved.content.raw.includes("<iframe")) !== Boolean(input.hasFile))) throw new Error("WordPress dosya durumunu saklamadı; taslak yayımlanmadı.");
  await saveSeo(baseUrl, authorization, draft.id, input.seo, input.noindex);
  const published = await savePage(baseUrl, authorization, { status: "publish" }, draft.id);
  if (published.status !== "publish" || published.slug !== input.slug) throw new Error("WordPress sayfayı yayımlamadı.");
  const link = new URL(published.link);
  if (link.protocol !== "https:" || !["aytercume.com", "www.aytercume.com"].includes(link.hostname)) throw new Error("WordPress beklenmeyen bir sayfa adresi döndürdü.");
  return { id: published.id, url: link.toString(), reused: false };
}

export async function ensureAyVerificationLanding() {
  return ensurePage({
    slug: AY_VERIFICATION_LANDING_SLUG,
    title: "Belge Doğrulama",
    content: `${ayVerificationLandingHtml()}<!-- AY_VERIFICATION_LANDING:1 -->`,
    marker: "AY_VERIFICATION_LANDING:1",
    seo: ayVerificationSeo(),
    noindex: false,
    refreshPublished: true,
  });
}

export async function findAyVerificationDocument(token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) return null;
  const { baseUrl, authorization } = config();
  const slug = `belge-dogrulama-${token}`;
  const page = (await pagesBySlug(baseUrl, authorization, slug)).find((item) => item.slug === slug);
  if (!page) return null;
  const document = readAyVerificationDocument(page.content?.raw || "", `AY_VERIFICATION:${token}`);
  return { id: page.id, status: page.status, url: page.link, document, hasFile: Boolean(document.fileUrl) };
}

export async function publishAyVerificationDocument(document: AyVerificationDocument, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Geçersiz doğrulama kimliği.");
  const slug = `belge-dogrulama-${token}`;
  return ensurePage({
    slug,
    title: `Belge Doğrulama – ${document.documentNumber}`,
    content: ayVerificationDocumentHtml(document, `AY_VERIFICATION:${token}`),
    marker: `AY_VERIFICATION:${token}`,
    seo: ayVerificationSeo(document.documentNumber, Boolean(document.fileUrl)),
    noindex: true,
    hasFile: Boolean(document.fileUrl),
  });
}

export async function attachAyVerificationPdf(token: string, fileUrl: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Geçersiz doğrulama kimliği.");
  const { baseUrl, authorization } = config();
  const current = await findAyVerificationDocument(token);
  if (!current || current.status !== "publish") throw new Error("Yayımlanmış doğrulama sayfası bulunamadı.");
  if (current.hasFile) throw new Error("Bu sayfaya PDF zaten eklenmiş; mevcut dosya değiştirilmedi.");
  const document = { ...current.document, fileUrl };
  const marker = `AY_VERIFICATION:${token}`;
  const content = ayVerificationDocumentHtml(document, marker);
  await saveSeo(baseUrl, authorization, current.id, ayVerificationSeo(document.documentNumber, true), true);
  const updated = await savePage(baseUrl, authorization, { content }, current.id);
  if (updated.status !== "publish" || updated.slug !== `belge-dogrulama-${token}`) throw new Error("WordPress mevcut doğrulama sayfasını güncellemedi.");
  const saved = await pageById(baseUrl, authorization, current.id);
  if (!saved.content?.raw?.includes(marker) || !saved.content.raw.includes(fileUrl) || !saved.content.raw.includes("<iframe")) throw new Error("WordPress PDF görünümünü kaydetmedi.");
  const confirmed = readAyVerificationDocument(saved.content.raw, marker);
  if (confirmed.fileUrl !== fileUrl) throw new Error("WordPress PDF bağlantısını kaydetmedi.");
  return { id: current.id, url: current.url, document: confirmed };
}
