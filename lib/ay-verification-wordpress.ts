import { AY_VERIFICATION_LANDING_SLUG, ayVerificationDocumentHtml, ayVerificationLandingHtml, ayVerificationSeo, type AyVerificationDocument } from "./ay-verification-page";

type WpPage = {
  id: number;
  slug: string;
  status: string;
  link: string;
  content?: { raw?: string; rendered?: string };
  message?: string;
};

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
  const params = new URLSearchParams({ context: "edit", slug, per_page: "5", _fields: "id,slug,status,link,content" });
  return wpJson<WpPage[]>(`${baseUrl}/wp-json/wp/v2/pages?${params}`, authorization);
}

async function pageById(baseUrl: string, authorization: string, id: number) {
  return wpJson<WpPage>(`${baseUrl}/wp-json/wp/v2/pages/${id}?context=edit&_fields=id,slug,status,link,content`, authorization);
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

async function ensurePage(input: { slug: string; title: string; content: string; marker: string; seo: { title: string; description: string }; noindex: boolean; refreshPublished?: boolean }) {
  const { baseUrl, authorization } = config();
  const matches = await pagesBySlug(baseUrl, authorization, input.slug);
  const existing = matches.find((page) => page.slug === input.slug);
  if (existing && !existing.content?.raw?.includes(input.marker)) throw new Error("Aynı adreste farklı bir WordPress sayfası mevcut; üzerine yazılmadı.");
  if (existing?.status === "publish" && !input.refreshPublished) return { id: existing.id, url: existing.link, reused: true };
  if (existing?.status === "publish") {
    await savePage(baseUrl, authorization, { title: input.title, content: input.content, excerpt: input.seo.description }, existing.id);
    const saved = await pageById(baseUrl, authorization, existing.id);
    if (!saved.content?.raw?.includes(input.marker)) throw new Error("WordPress doğrulama sayfası işaretini saklamadı.");
    await saveSeo(baseUrl, authorization, existing.id, input.seo, input.noindex);
    return { id: existing.id, url: existing.link, reused: true };
  }
  const draft = existing || await savePage(baseUrl, authorization, {
    title: input.title,
    content: input.content,
    excerpt: input.seo.description,
    slug: input.slug,
    status: "draft",
    comment_status: "closed",
    ping_status: "closed",
  });
  if (draft.slug !== input.slug || draft.status !== "draft") throw new Error("WordPress beklenen sayfa taslağını oluşturmadı.");
  if (existing) await savePage(baseUrl, authorization, { title: input.title, content: input.content, excerpt: input.seo.description }, draft.id);
  const saved = await pageById(baseUrl, authorization, draft.id);
  if (!saved.content?.raw?.includes(input.marker)) throw new Error("WordPress doğrulama sayfası işaretini saklamadı; taslak yayımlanmadı.");
  if (input.noindex && (!saved.content.raw.includes("<iframe") || !saved.content.raw.includes("ayv-file"))) throw new Error("WordPress dosya görünümünü saklamadı; taslak yayımlanmadı.");
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
  if (!page.content?.raw?.includes(`AY_VERIFICATION:${token}`)) throw new Error("Doğrulama sayfası işareti uyuşmuyor.");
  return { id: page.id, status: page.status, url: page.link };
}

export async function publishAyVerificationDocument(document: AyVerificationDocument, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Geçersiz doğrulama kimliği.");
  const slug = `belge-dogrulama-${token}`;
  return ensurePage({
    slug,
    title: `Belge Doğrulama – ${document.documentNumber}`,
    content: ayVerificationDocumentHtml(document, `AY_VERIFICATION:${token}`),
    marker: `AY_VERIFICATION:${token}`,
    seo: ayVerificationSeo(document.documentNumber),
    noindex: true,
  });
}
