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
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Authorization: authorization, Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
    throw new Error(`AY WordPress bağlantısı kurulamadı${code ? ` (${code})` : ""}.`);
  }
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

export async function listAyVerificationDocuments(query: string, pageNumber: number) {
  const { baseUrl, authorization } = config();
  const params = new URLSearchParams({ context: "edit", per_page: "50", page: String(pageNumber), orderby: "date", order: "desc", _fields: "id,slug,status,link,content" });
  params.set("search", query || "Belge Doğrulama");
  const response = await fetch(`${baseUrl}/wp-json/wp/v2/pages?${params}`, { headers: { Authorization: authorization, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (response.status === 400 && pageNumber > 1) return { records: [], hasMore: false };
  if (!response.ok) throw new Error(`Ay Tercüme belge listesi okunamadı (${response.status}).`);
  const pages = await response.json() as WpPage[];
  if (!Array.isArray(pages)) throw new Error("WordPress belge listesi geçersiz.");
  const records = pages.flatMap((item) => {
    const token = /^belge-dogrulama-([a-f0-9-]{36})$/.exec(item.slug)?.[1];
    if (!token || item.status !== "publish") return [];
    try {
      const document = readAyVerificationDocument(item.content?.raw || "", `AY_VERIFICATION:${token}`);
      if (query && !`${document.documentNumber} ${document.customer} ${document.documentType}`.toLocaleLowerCase("tr-TR").includes(query.toLocaleLowerCase("tr-TR"))) return [];
      return [{ token, url: item.link, details: document, hasFile: Boolean(document.fileUrl) }];
    } catch { return []; }
  });
  const totalPages = Number(response.headers.get("x-wp-totalpages") || 1);
  return { records, hasMore: pageNumber < totalPages };
}

export async function findAyVerificationMediaId(fileUrl: string, pageId: number, storedId?: number) {
  const { baseUrl, authorization } = config();
  if (storedId) {
    const item = await wpJson<{ id: number; source_url: string }>(`${baseUrl}/wp-json/wp/v2/media/${storedId}?context=edit&_fields=id,source_url`, authorization);
    return item.source_url === fileUrl ? item.id : undefined;
  }
  const params = new URLSearchParams({ context: "edit", parent: String(pageId), per_page: "100", _fields: "id,source_url" });
  const media = await wpJson<{ id: number; source_url: string }[]>(`${baseUrl}/wp-json/wp/v2/media?${params}`, authorization);
  return media.find((item) => item.source_url === fileUrl)?.id;
}

export async function deleteAyVerificationDocument(token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Geçersiz doğrulama kimliği.");
  const { baseUrl, authorization } = config();
  const current = await findAyVerificationDocument(token);
  if (!current || current.status !== "publish") throw new Error("Yayımlanmış doğrulama sayfası bulunamadı.");
  const page = await pageById(baseUrl, authorization, current.id);
  if (page.slug !== `belge-dogrulama-${token}` || !page.content?.raw?.includes(`AY_VERIFICATION:${token}`)) throw new Error("Bu sayfa AY Tercüme doğrulama sistemi tarafından yönetilmiyor; silinmedi.");
  await wpJson<WpPage>(`${baseUrl}/wp-json/wp/v2/pages/${current.id}?force=true`, authorization, { method: "DELETE" });
  const remaining = (await pagesBySlug(baseUrl, authorization, `belge-dogrulama-${token}`)).find((item) => item.id === current.id);
  if (remaining) throw new Error("WordPress doğrulama sayfasını silmedi.");
  return current;
}

export async function refreshAyVerificationDocumentDesign(token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Geçersiz doğrulama kimliği.");
  const { baseUrl, authorization } = config();
  const current = await findAyVerificationDocument(token);
  if (!current || current.status !== "publish") throw new Error("Yayımlanmış doğrulama sayfası bulunamadı.");
  const slug = `belge-dogrulama-${token}`;
  const before = await pageById(baseUrl, authorization, current.id);
  if (before.content?.raw?.includes("<!-- AY_VERIFICATION_DESIGN:2 -->")) return { id: current.id, url: current.url, reused: true };
  const content = ayVerificationDocumentHtml(current.document, `AY_VERIFICATION:${token}`);
  const updated = await savePage(baseUrl, authorization, { content }, current.id);
  if (updated.status !== "publish" || updated.slug !== slug) throw new Error("WordPress mevcut sayfanın durumunu veya adresini değiştirdi.");
  const saved = await pageById(baseUrl, authorization, current.id);
  const raw = saved.content?.raw || "";
  const confirmed = readAyVerificationDocument(raw, `AY_VERIFICATION:${token}`);
  if (!raw.includes("<!-- AY_VERIFICATION_DESIGN:2 -->") || !raw.includes("ayv-seal") || Boolean(raw.includes("<iframe")) !== current.hasFile || JSON.stringify(confirmed) !== JSON.stringify(current.document)) throw new Error("WordPress yeni tasarımı ve belge bilgilerini birlikte saklamadı.");
  return { id: current.id, url: current.url, reused: false };
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

export async function setAyVerificationPdf(token: string, file?: { url: string; mediaId?: number }) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Geçersiz doğrulama kimliği.");
  const { baseUrl, authorization } = config();
  const current = await findAyVerificationDocument(token);
  if (!current || current.status !== "publish") throw new Error("Yayımlanmış doğrulama sayfası bulunamadı.");
  const document = { ...current.document, fileUrl: file?.url, mediaId: file?.mediaId };
  const marker = `AY_VERIFICATION:${token}`;
  const content = ayVerificationDocumentHtml(document, marker);
  await saveSeo(baseUrl, authorization, current.id, ayVerificationSeo(document.documentNumber, Boolean(file)), true);
  const updated = await savePage(baseUrl, authorization, { content }, current.id);
  if (updated.status !== "publish" || updated.slug !== `belge-dogrulama-${token}`) throw new Error("WordPress mevcut doğrulama sayfasını güncellemedi.");
  const saved = await pageById(baseUrl, authorization, current.id);
  if (!saved.content?.raw?.includes(marker) || Boolean(saved.content.raw.includes("<iframe")) !== Boolean(file) || (file && !saved.content.raw.includes(file.url))) throw new Error("WordPress PDF görünümünü kaydetmedi.");
  const confirmed = readAyVerificationDocument(saved.content.raw, marker);
  if (confirmed.fileUrl !== file?.url || confirmed.mediaId !== file?.mediaId) throw new Error("WordPress PDF bağlantısını kaydetmedi.");
  return { id: current.id, url: current.url, document: confirmed };
}

export async function attachAyVerificationPdf(token: string, fileUrl: string, mediaId?: number) {
  const current = await findAyVerificationDocument(token);
  if (current?.hasFile) throw new Error("Bu sayfaya PDF zaten eklenmiş; mevcut dosya değiştirilmedi.");
  return setAyVerificationPdf(token, { url: fileUrl, mediaId });
}
