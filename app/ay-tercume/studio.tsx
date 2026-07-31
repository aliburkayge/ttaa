"use client";

/* Generated previews use authenticated data URLs and cannot use next/image. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import type { AyContentPackage } from "../../lib/ay-render";
import { JobApiError, useContentJob } from "../../lib/use-content-job";
import CompanySwitcher from "../company-switcher";
import ProjectLibrary from "../project-library";

type AyView = "create" | "library" | "brand" | "integrations";
type AyTab = "preview" | "seo" | "html" | "head" | "schema";
type AyDurableJobResult = { package: AyContentPackage; projectId?: string; warning?: string };

type AyIntegrationHealth = {
  wordpress?: { connected: boolean; user?: { name: string; seoPlugin?: string }; error?: string };
  supabase?: { connected: boolean; storageReady: boolean; error?: string };
  openai?: { connected: boolean; model?: string; image?: { connected: boolean }; error?: string };
  whatsapp?: { connected: boolean; phone?: string; error?: string };
};

type AyBrief = {
  topic: string;
  mode: "new" | "update";
  length: "standard" | "guide" | "service";
  primaryKeyword: string;
  desiredWordCount: string;
  country: string;
  audience: string;
  documentType: string;
  sourceText: string;
  includeH1: boolean;
  visibleBreadcrumb: boolean;
  articleSchema: boolean;
  faqSchema: boolean;
};

const EMPTY_BRIEF: AyBrief = {
  topic: "",
  mode: "new",
  length: "guide",
  primaryKeyword: "",
  desiredWordCount: "",
  country: "",
  audience: "",
  documentType: "",
  sourceText: "",
  includeH1: true,
  visibleBreadcrumb: true,
  articleSchema: true,
  faqSchema: true,
};

const AY_STAGES = [
  ["Bilgiler", "Başlık ve kapsam"],
  ["Araştırma", "Resmî kaynaklar"],
  ["İçerik", "Yazı ve SEO"],
  ["Görseller", "Featured + içerik"],
  ["WordPress", "Medya + taslak"],
  ["Hazır", "Paket tamamlandı"],
];

class AyPipelineError extends Error {
  constructor(message: string, readonly step: "images" | "wordpress", readonly retryable: boolean) {
    super(message);
  }
}

function AyToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-ui" aria-hidden="true"><span /></span></label>;
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function ArticleRenderer({ content }: { content?: AyContentPackage }) {
  if (!content) return null;
  const inline = content.images?.inline;
  const inlineFigure = inline && /^(?:data:image\/|https:\/\/)/.test(inline.dataUrl)
    ? `<figure class="ayc-inline-image"><img src="${escapeAttribute(inline.dataUrl)}" alt="${escapeAttribute(inline.alt)}" width="${inline.width}" height="${inline.height}"><figcaption>${escapeAttribute(inline.caption)}</figcaption></figure>`
    : "";
  const previewHtml = content.html.replace("<!-- AY_INLINE_IMAGE -->", inlineFigure);
  return <div className="wordpress-package-preview" aria-label="AY Tercüme WordPress paket önizlemesi"><div className="preview-fidelity-note"><span>✓</span><p><strong>Gerçek paket önizlemesi</strong>Aynı semantik HTML, iki görsel ve bağımsız AY CSS teması WordPress taslağına aktarılır.</p></div>{content.images?.featured ? <figure className="ay-featured-preview"><img src={content.images.featured.dataUrl} alt={content.images.featured.alt} width={content.images.featured.width} height={content.images.featured.height} /><figcaption>{content.images.featured.caption}</figcaption></figure> : null}<div dangerouslySetInnerHTML={{ __html: previewHtml }} /></div>;
}

export default function AyTercumeStudio({ email }: { email: string }) {
  const asyncJob = useContentJob<AyDurableJobResult>("ay-tercume");
  const [activeView, setActiveView] = useState<AyView>("create");
  const [activeTab, setActiveTab] = useState<AyTab>("preview");
  const [brief, setBrief] = useState<AyBrief>(EMPTY_BRIEF);
  const [result, setResult] = useState<AyContentPackage | null>(null);
  const [pendingPackage, setPendingPackage] = useState<AyContentPackage | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const [canRetryImages, setCanRetryImages] = useState(false);
  const [canRetryFinalize, setCanRetryFinalize] = useState(false);
  const [warning, setWarning] = useState("");
  const [copied, setCopied] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [health, setHealth] = useState<AyIntegrationHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [resultProjectId, setResultProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  useEffect(() => {
    const current = asyncJob.job;
    if (!current) return;
    const timer = window.setTimeout(() => {
      const stages: Record<string, number> = {
        queued: 1, research: 1, writer: 2, writing: 2, editor: 2,
        "quality-control": 3, images: 4, "wordpress-media": 5,
        "wordpress-draft": 5, persistence: 5, completed: 6,
      };
      setStage(stages[current.stage] || 1);
      if (current.status === "queued" || current.status === "running") {
        setIsGenerating(true);
        setResult(null);
        setError("");
        return;
      }
      setIsGenerating(false);
      if (current.status === "succeeded" && current.result?.package) {
        setWarning(current.result.warning || "");
        setResultProjectId(current.result.projectId || current.result.package.projectId || null);
        completePackage(current.result.package);
      } else if (current.status === "failed" || current.status === "cancelled") {
        setError(current.error?.message || (current.status === "cancelled" ? "Çalışma güvenli şekilde iptal edildi." : "İçerik işi tamamlanamadı."));
        setCanRetryImages(Boolean(current.canRetry));
        setCanRetryFinalize(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // completePackage intentionally uses the current form snapshot for local cache only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asyncJob.job]);

  useEffect(() => {
    const saved = window.localStorage.getItem("ay-tercume-studio-state");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { brief?: AyBrief; result?: AyContentPackage; savedAt?: string };
      const timer = window.setTimeout(() => {
        if (parsed.brief) setBrief({ ...EMPTY_BRIEF, ...parsed.brief });
        if (parsed.result) {
          setResult(parsed.result);
          if (!parsed.result.images) {
            setPendingPackage(parsed.result);
            setCanRetryImages(true);
          }
        }
        if (parsed.savedAt) setSavedAt(parsed.savedAt);
      }, 0);
      return () => window.clearTimeout(timer);
    } catch { /* Geçersiz yerel taslak yok sayılır. */ }
  }, []);

  const codeOutput = useMemo(() => !result ? "" : activeTab === "schema" ? result.schema : activeTab === "head" ? result.head : result.html, [activeTab, result]);

  function updateBrief<K extends keyof AyBrief>(key: K, value: AyBrief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  function newProject() {
    setBrief(EMPTY_BRIEF);
    setResult(null);
    setPendingPackage(null);
    setError("");
    setCanRetryImages(false);
    setCanRetryFinalize(false);
    setWarning("");
    setStage(0);
    setActiveTab("preview");
  }

  async function requestImages(contentPackage: AyContentPackage) {
    const response = await fetch("/api/ay-tercume/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: contentPackage.preview.title,
        slug: contentPackage.slug,
        primaryPrompt: contentPackage.imagePrompt,
        suggestions: contentPackage.imageSuggestions,
      }),
    });
    const payload = (await response.json()) as { images?: AyContentPackage["images"]; error?: string };
    if (response.status === 401) {
      window.location.href = "/";
      throw new Error("Oturum süresi doldu. Lütfen yeniden giriş yapın.");
    }
    if (!response.ok || !payload.images) throw new AyPipelineError(payload.error || "Ay Tercüme görsel paketi tamamlanamadı.", "images", true);
    return { ...contentPackage, images: payload.images };
  }

  async function requestWordPressDraft(contentPackage: AyContentPackage) {
    const response = await fetch("/api/ay-tercume/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, package: contentPackage }),
    });
    const payload = (await response.json()) as { package?: AyContentPackage; error?: string; warning?: string; retryable?: boolean };
    if (response.status === 401) {
      window.location.href = "/";
      throw new AyPipelineError("Oturum süresi doldu. Lütfen yeniden giriş yapın.", "wordpress", false);
    }
    if (!response.ok || !payload.package) throw new AyPipelineError(payload.error || "Ay Tercüme WordPress taslağı oluşturulamadı.", "wordpress", Boolean(payload.retryable));
    setWarning(payload.warning || "");
    return payload.package;
  }

  function completePackage(contentPackage: AyContentPackage) {
    setResult(contentPackage);
    setPendingPackage(null);
    setCanRetryImages(false);
    setCanRetryFinalize(false);
    setActiveTab("preview");
    const time = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    setSavedAt(time);
    const localPackage = contentPackage.images ? {
      ...contentPackage,
      images: {
        featured: { ...contentPackage.images.featured, dataUrl: contentPackage.images.featured.wordpress?.url || "" },
        inline: { ...contentPackage.images.inline, dataUrl: contentPackage.images.inline.wordpress?.url || "" },
      },
    } : contentPackage;
    window.localStorage.setItem("ay-tercume-studio-state", JSON.stringify({ brief, result: localPackage, savedAt: time }));
    setStage(6);
  }

  async function generateLegacy() {
    if (!brief.topic.trim()) return;
    setIsGenerating(true);
    setResult(null);
    setPendingPackage(null);
    setError("");
    setCanRetryImages(false);
    setCanRetryFinalize(false);
    setWarning("");
    setStage(1);
    try {
      const response = await fetch("/api/ay-tercume/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brief) });
      setStage(2);
      const payload = (await response.json()) as { package?: AyContentPackage; error?: string };
      if (response.status === 401) {
        window.location.href = "/";
        throw new Error("Oturum süresi doldu. Lütfen yeniden giriş yapın.");
      }
      if (!response.ok || !payload.package) throw new Error(payload.error || "AY Tercüme içerik paketi tamamlanamadı.");
      setPendingPackage(payload.package);
      setStage(3);
      const withImages = await requestImages(payload.package);
      setPendingPackage(withImages);
      setStage(4);
      completePackage(await requestWordPressDraft(withImages));
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : "İçerik üretimi tamamlanamadı.";
      setError(message);
      setCanRetryImages(generationError instanceof AyPipelineError && generationError.step === "images" && generationError.retryable);
      setCanRetryFinalize(generationError instanceof AyPipelineError && generationError.step === "wordpress" && generationError.retryable);
    } finally {
      setIsGenerating(false);
    }
  }

  async function generate() {
    if (!brief.topic.trim()) return;
    setIsGenerating(true);
    setResult(null);
    setPendingPackage(null);
    setError("");
    setCanRetryImages(false);
    setCanRetryFinalize(false);
    setWarning("");
    setStage(1);
    try {
      await asyncJob.start(brief as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof JobApiError && error.code === "ASYNC_JOBS_DISABLED") {
        await generateLegacy();
        return;
      }
      setIsGenerating(false);
      setError(error instanceof Error ? error.message : "Dayanıklı içerik işi başlatılamadı.");
    }
  }

  async function retryImages() {
    if (!pendingPackage) return void generate();
    setIsGenerating(true);
    setError("");
    setCanRetryImages(false);
    setCanRetryFinalize(false);
    setStage(3);
    try {
      const withImages = await requestImages(pendingPackage);
      setPendingPackage(withImages);
      setStage(4);
      completePackage(await requestWordPressDraft(withImages));
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "Ay Tercüme görselleri üretilemedi.");
      setCanRetryImages(imageError instanceof AyPipelineError && imageError.step === "images" && imageError.retryable);
      setCanRetryFinalize(imageError instanceof AyPipelineError && imageError.step === "wordpress" && imageError.retryable);
    } finally {
      setIsGenerating(false);
    }
  }

  async function retryFinalize() {
    if (!pendingPackage?.images) return void generate();
    setIsGenerating(true);
    setError("");
    setCanRetryFinalize(false);
    setStage(4);
    try {
      completePackage(await requestWordPressDraft(pendingPackage));
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Ay Tercüme WordPress taslağı oluşturulamadı.");
      setCanRetryFinalize(draftError instanceof AyPipelineError && draftError.retryable);
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyCurrent() {
    if (!result) return;
    const text = activeTab === "schema" ? result.schema : activeTab === "head" ? result.head : activeTab === "html" ? result.html : `${result.head}\n\n${result.html}\n\n<script type="application/ld+json">\n${result.schema}\n</script>`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadHtml() {
    if (!result) return;
    const fullDocument = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${result.head}<link rel="stylesheet" href="ay-tercume-article.css"></head><body>${result.html}<script type="application/ld+json">${result.schema.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
    const blob = new Blob([fullDocument], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.slug.replaceAll("/", "") || "ay-tercume-icerik"}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  async function loadIntegrationHealth() {
    setHealthLoading(true);
    try {
      const response = await fetch("/api/integrations/health?brand=ay-tercume", { cache: "no-store" });
      if (response.ok) setHealth(await response.json() as AyIntegrationHealth);
    } finally {
      setHealthLoading(false);
    }
  }

  useEffect(() => {
    // Mirrors the mount-time fetch idiom used by checkIntegrations() in app/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeView === "integrations" && !health && !healthLoading) void loadIntegrationHealth();
  }, [activeView, health, healthLoading]);

  return (
    <main className="studio-shell ay-studio">
      <header className="studio-header">
        <CompanySwitcher current="ay-tercume" />
        <div className="header-actions"><span className="ay-local-badge"><i /> Yerel çalışma</span><span className="save-state">{savedAt ? `${savedAt} kaydedildi` : email}</span><button className="ghost-button" onClick={newProject}>Yeni içerik</button><button className="ghost-button quiet" onClick={() => void signOut()}>Çıkış</button></div>
      </header>

      <div className="studio-layout">
        <nav className="rail" aria-label="Ay Tercüme ana menü">
          {([ ["create", "İçerik oluştur"], ["library", "Son çalışma"], ["brand", "Tasarım sistemi"], ["integrations", "Bağlantılar"] ] as [AyView, string][]).map(([view, label]) => <button key={view} className={activeView === view ? "active" : ""} onClick={() => setActiveView(view)}><small>{label}</small></button>)}
        </nav>

        <section className="workspace">
          {activeView === "create" ? <>
            <div className="workspace-heading"><div><span className="page-kicker">AY TERCÜME · YENİ ÇALIŞMA</span><h1>İçerik üretin</h1><p>Türkçe araştırma, SEO/AEO, dinamik FAQ ve WordPress&apos;e hazır sayfa paketi tek akışta hazırlanır.</p></div><div className="safety-note"><span>✓</span><div><strong>Firma verileri tamamen ayrı</strong><small>TTAA promptları, linkleri ve WordPress bilgileri kullanılmaz.</small></div></div></div>

            <aside className="brief-panel">
              <div className="panel-heading"><div><small>1. ADIM</small><h2>İçerik bilgileri</h2><p>Yalnızca başlık zorunludur. Sistem arama niyetini ve diğer alanları kendisi belirleyebilir.</p></div></div>
              <div className="form-stack">
                <label className="primary-field">Yazı başlığı<input value={brief.topic} onChange={(event) => updateBrief("topic", event.target.value)} placeholder="Örn. Apostil Nedir ve Hangi Belgeler İçin Gerekir?" autoFocus /><small>Başlık konu kilidinin sınırını ve tek ana arama niyetini belirler.</small></label>
                <div className="two-fields"><label>İçerik türü<select value={brief.mode} onChange={(event) => updateBrief("mode", event.target.value as AyBrief["mode"])}><option value="new">Yeni yazı oluştur</option><option value="update">Mevcut yazıyı geliştir</option></select></label><label>İçerik yapısı<select value={brief.length} onChange={(event) => updateBrief("length", event.target.value as AyBrief["length"])}><option value="standard">Standart makale</option><option value="guide">Detaylı rehber</option><option value="service">Hizmet sayfası</option></select></label></div>
              </div>

              <details className="advanced-card"><summary><span><strong>İsteğe bağlı ayrıntılar</strong><small>Daha fazla kontrol istiyorsanız doldurun</small></span><b>+</b></summary><div className="advanced-content form-stack">
                <div className="two-fields"><label>Focus keyword<input value={brief.primaryKeyword} onChange={(event) => updateBrief("primaryKeyword", event.target.value)} placeholder="Boşsa otomatik belirlenir" /></label><label>Kelime hedefi<input type="number" min="800" max="4000" step="100" value={brief.desiredWordCount} onChange={(event) => updateBrief("desiredWordCount", event.target.value)} placeholder="Örn. 2200" /></label></div>
                <div className="two-fields"><label>Ülke / şehir<input value={brief.country} onChange={(event) => updateBrief("country", event.target.value)} placeholder="Başlıktan belirlenebilir" /></label><label>Hedef okuyucu<input value={brief.audience} onChange={(event) => updateBrief("audience", event.target.value)} placeholder="Örn. vize başvurusu yapanlar" /></label></div>
                <label>Belge veya hizmet türü<input value={brief.documentType} onChange={(event) => updateBrief("documentType", event.target.value)} placeholder="Örn. diploma, noter onayı, apostil" /></label>
                <label>Mevcut metin veya notlar<textarea value={brief.sourceText} onChange={(event) => updateBrief("sourceText", event.target.value)} placeholder="Geliştirilecek eski yazıyı veya kaynak notlarını buraya ekleyin." /></label>
              </div></details>

              <details className="advanced-card output-settings"><summary><span><strong>Teknik çıktı ayarları</strong><small>Önerilen ayarlar hazır seçilidir</small></span><b>+</b></summary><div className="settings-card"><AyToggle label="İçerikte H1 kullan" checked={brief.includeH1} onChange={(value) => updateBrief("includeH1", value)} /><AyToggle label="Breadcrumb göster" checked={brief.visibleBreadcrumb} onChange={(value) => updateBrief("visibleBreadcrumb", value)} /><AyToggle label="Article schema" checked={brief.articleSchema} onChange={(value) => updateBrief("articleSchema", value)} /><AyToggle label="FAQ schema" checked={brief.faqSchema} onChange={(value) => updateBrief("faqSchema", value)} /></div></details>

              <button className="generate-button" onClick={() => void generate()} disabled={isGenerating || !brief.topic.trim()}><span>{isGenerating ? "Paket hazırlanıyor..." : "İçeriği ve 2 görseli oluştur"}</span><b aria-hidden="true">→</b></button>
              <p className="privacy-note"><span>✓</span> Yazı ve iki görsel birlikte tamamlanmadan yeni sonuç ekranda gösterilmez.</p>
            </aside>

            <section className="output-panel">
              <div className="workflow-strip">{AY_STAGES.map(([label, note], index) => <div key={label} className={stage > index ? "done" : stage === index ? "current" : ""}><span>{stage > index ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{note}</small></div></div>)}</div>
              {error ? <div className="publish-banner error"><span>!</span><div><strong>{asyncJob.job?.canRetry ? "Eksik aşama yeniden denenebilir" : canRetryImages ? "Görsel paketi tamamlanamadı" : canRetryFinalize ? "WordPress aktarımı tamamlanamadı" : "İçerik tamamlanamadı"}</strong><small>{error}</small>{asyncJob.job?.error?.requestId ? <small>Takip kodu: {asyncJob.job.error.requestId}</small> : null}</div>{asyncJob.job?.canRetry ? <button onClick={() => void asyncJob.retry()}>Kaldığı yerden yeniden dene</button> : canRetryImages || canRetryFinalize ? <button onClick={() => void (canRetryFinalize ? retryFinalize() : retryImages())}>{canRetryFinalize ? "Taslak aktarımını yeniden dene" : "Görselleri yeniden dene"}</button> : null}</div> : null}
              {result && !isGenerating && !error && result.images && result.wordpress ? <div className="publish-banner success"><span>✓</span><div><strong>Ay Tercüme WordPress taslağı hazır</strong><small>Yazı #{result.wordpress.id} · 2 görsel yüklendi · {result.wordpress.seo.applied ? `${result.wordpress.seo.plugin.toUpperCase()} SEO alanları doğrulandı` : result.wordpress.seo.focusKeywordApplied ? "Focus keyword doğrulandı; diğer SEO alanlarını kontrol edin" : "SEO alanları kontrol edilmeli"}</small>{warning ? <small>{warning}</small> : null}</div><div style={{ display: "flex", gap: 8 }}>{resultProjectId && <button type="button" onClick={() => { setEditingProjectId(resultProjectId); setActiveView("library"); }}>Düzenle ve WordPress&apos;e Gönder</button>}<a href={result.wordpress.editUrl} target="_blank" rel="noreferrer">WordPress&apos;te aç</a></div></div> : null}
              {result && !isGenerating && !error && !result.images ? <div className="publish-banner attention"><span>IMG</span><div><strong>Yerel metin paketi yüklendi</strong><small>Büyük görsel dosyaları tarayıcı hafızasına kaydedilmez. Metni yeniden üretmeden iki görseli tekrar hazırlayabilirsiniz.</small></div><button onClick={() => void retryImages()}>2 görseli üret</button></div> : null}
              <div className="output-toolbar"><div className="tab-list" role="tablist">{([ ["preview", "Önizleme"], ["seo", "SEO özeti"], ["html", "HTML"], ["head", "SEO Head"], ["schema", "Schema"] ] as [AyTab, string][]).map(([tab, label]) => <button role="tab" aria-selected={activeTab === tab} key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{label}</button>)}</div><div className="tool-actions"><button onClick={downloadHtml} disabled={!result}>HTML indir</button><button className="copy-button" onClick={() => void copyCurrent()} disabled={!result}>{copied ? "Kopyalandı ✓" : activeTab === "preview" ? "Paketi kopyala" : "Kopyala"}</button></div></div>
              <div className="output-canvas">
                {isGenerating ? <div className="private-progress"><span className="pulse-ring" /><small>AY TERCÜME PAKETİ HAZIRLANIYOR</small><h2>{asyncJob.job?.stage === "research" ? "Resmî kaynaklar araştırılıyor" : asyncJob.job?.stage === "writer" || asyncJob.job?.stage === "writing" ? "Türkçe yazı hazırlanıyor" : asyncJob.job?.stage === "editor" ? "Editör kontrolü yapılıyor" : asyncJob.job?.stage === "quality-control" ? "Konu kilidi ve kalite kapıları denetleniyor" : asyncJob.job?.stage === "images" ? "İki marka görseli hazırlanıyor" : asyncJob.job?.stage?.startsWith("wordpress") ? "Görseller ve taslak WordPress'e aktarılıyor" : "Çalışma kuyruğa alındı"}</h2><p>Bu çalışma Railway worker üzerinde devam eder. Sayfayı kapatabilir veya yenileyebilirsiniz; tekrar girişte kaldığı yerden görünür.</p>{asyncJob.job?.canCancel ? <button className="ghost-button" onClick={() => void asyncJob.cancel()}>Çalışmayı iptal et</button> : null}<div className="progress-track"><span style={{ width: `${asyncJob.job?.progress ?? Math.max(16, Math.min(94, stage * 18))}%` }} /></div></div> :
                !result ? <div className="empty-result ay-empty-result"><span>AY</span><h2>Yeni içeriğiniz burada görünecek</h2><p>Başlığı girip “İçeriği ve 2 görseli oluştur” düğmesine basın. WordPress bağlantısı olmadan da eksiksiz yayın paketi hazırlanır.</p><ul><li>Türkçe konu kilidi</li><li>Resmî kaynak araştırması</li><li>SEO ve AEO paketi</li><li>Featured + içerik görseli</li></ul></div> :
                activeTab === "preview" ? <ArticleRenderer content={result} /> :
                activeTab === "html" || activeTab === "head" || activeTab === "schema" ? <div className="code-view"><div className="code-bar"><span>{activeTab === "html" ? "ay-article-body.html" : activeTab === "head" ? "ay-seo-head.html" : "ay-structured-data.json"}</span><small>{activeTab === "html" ? "Semantik HTML · bağımsız AY CSS" : activeTab === "head" ? "AIOSEO aktarımına hazır" : "Article + görünür FAQ eşleşmesi"}</small></div><pre><code>{codeOutput}</code></pre></div> :
                <div className="seo-view">
                  <div className="seo-score"><span>OK</span><div><strong>Konu kilidi ve kalite kapıları geçti</strong><small>Türkçe doğallık, tekrar, FAQ ve resmî iddia güvenliği denetlendi</small></div></div>
                  <div className="seo-grid"><article><small>FOCUS KEYWORD</small><h3>{result.focusKeyword}</h3><span>Tek ana arama niyeti · {result.focusKeyword.split(/\s+/).filter(Boolean).length} kelime</span></article><article><small>SECONDARY KEYWORDS</small><p>{result.secondaryKeywords.join(" · ")}</p><span>{result.secondaryKeywords.length} benzersiz yakın varyasyon</span></article><article><small>SEO TITLE</small><h3>{result.title}</h3><span>{result.title.length} karakter · hedef 50–60</span></article><article><small>META DESCRIPTION</small><p>{result.meta}</p><span>{result.meta.length} karakter · hedef 120–160</span></article><article><small>SLUG</small><code>{result.slug}</code><span>Kısa, tireli ve focus keyword odaklı</span></article><article><small>CANONICAL</small><code>{result.canonical}</code><span>{result.canonicalReady ? "Ay site adresiyle hazır" : "AY_WP_URL girildiğinde mutlak URL uygulanacak"}</span></article></div>
                  <div className="link-plan"><div><small>GÖRSEL PAKETİ</small><h3>Ay Tercüme için üretilen iki marka görseli</h3></div>{result.images ? ([result.images.featured, result.images.inline]).map((item, index) => <article className="ay-image-metadata" key={item.role}><img src={item.dataUrl} alt={item.alt} /><div><strong>{index === 0 ? "Featured image" : "İçerik görseli"}</strong><code>{item.fileName}</code><small>{item.alt}</small></div><span>{item.width}×{item.height} · {item.format.toUpperCase()} · {item.model}</span></article>) : result.imageSuggestions.map((item, index) => <article key={`${item.placement}-${index}`}><div><strong>{item.placement}</strong><code>{item.altText}</code></div><span>Yerel kayıt · görsel yeniden üretilebilir</span></article>)}</div>
                  <div className="link-plan"><div><small>BAĞLANTI DENETİMİ</small><h3>AY sayfaları ve doğrulanmış resmî kaynaklar</h3></div>{result.links.map((link) => <article key={link.url}><div><strong>{link.anchor}</strong><code>{link.url}</code></div><span>{link.source === "official" ? "RESMÎ KAYNAK" : "INTERNAL"} · {link.reason}</span></article>)}</div>
                  <div className="publish-check"><small>SON KONTROLLER</small><ul><li><span>✓</span>Tek focus keyword ve 3–5 benzersiz secondary keyword</li><li><span>✓</span>TL;DR, 7–10 dinamik H2 ve 7–10 dinamik FAQ</li><li><span>✓</span>Title, meta, slug ve keyword yerleşimi kalite kapısından geçti</li><li><span>✓</span>Internal linkler yalnızca AY envanterinden seçildi</li><li><span>✓</span>Resmî kaynak URL&apos;leri tekilleştirildi</li><li><span>✓</span>Article ve görünür FAQ schema içeriğiyle eşleşiyor</li><li><span>!</span>Yayın öncesi güncel kurum şartlarını insan gözüyle doğrulayın</li></ul><a className="shared-css-download" href="/ay-tercume-article.css" download>AY WordPress CSS dosyasını indir</a></div>
                </div>}
              </div>
            </section>
          </> : null}

          {activeView === "library" ? <ProjectLibrary brand="ay-tercume" brandLabel="AY Tercüme" initialProjectId={editingProjectId} onProjectClosed={() => setEditingProjectId(null)} /> : null}
          {activeView === "brand" ? <section className="utility-view ay-utility"><small>AY TERCÜME · TASARIM SİSTEMİ</small><h1>Temiz, güven veren ve modern bir dil.</h1><p>Panel ve WordPress makale teması mint, mavi, koyu metin ve beyaz temel üzerine kuruludur.</p><div className="brand-grid"><article><span style={{ background: "#43cc9b" }} /><strong>Ana turkuaz / mint</strong><code>#43cc9b</code></article><article><span style={{ background: "#009fe4" }} /><strong>Vurgu mavisi</strong><code>#009fe4</code></article><article><span style={{ background: "#0f0b08" }} /><strong>Koyu yazı</strong><code>#0f0b08</code></article><article><span style={{ background: "#ffffff", border: "1px solid #dce5e1" }} /><strong>Ana arka plan</strong><code>#ffffff</code></article></div><div className="rules-panel"><h2>Her içerikte zorunlu</h2><ul><li>Türkçe, sade ve abartısız anlatım</li><li>Tek H1 ve düzenli H2/H3 hiyerarşisi</li><li>Mobil uyumlu ayc- sınıf ön eki</li><li>WordPress tema uyumluluğu için kapsüllenmiş makale stilleri</li><li>Sahte mühür, resmî logo veya kişisel veri içermeyen görsel brief</li></ul></div></section> : null}
          {activeView === "integrations" ? <section className="utility-view ay-utility"><small>AY TERCÜME · BAĞLANTILAR</small><h1>İçerik, görsel ve WordPress taslak motoru hazır.</h1><p>OpenAI ve Ay Tercüme WordPress bağlantıları sunucu tarafında çalışır. Site bilgileri TTAA&apos;dan tamamen ayrıdır; gönderilen yazılar yalnızca taslak olarak oluşturulur.</p><div className="health-grid ay-health-grid"><article className="healthy"><span>✓</span><div><small>OPENAI İÇERİK</small><h3>Hazır</h3><p>Türkçe writer + editor + iki repair geçişi</p></div></article><article className="healthy"><span>✓</span><div><small>AY HTML TEMASI</small><h3>Hazır</h3><p>Bağımsız, responsive ortak CSS ve güvenli fallback</p></div></article><article className="healthy"><span>IMG</span><div><small>AY GÖRSEL PAKETİ</small><h3>Hazır</h3><p>İki paralel görsel · gerçek logo sol üstte · Ay renk sistemi</p></div></article><article className={health?.wordpress?.connected ? "healthy" : "attention"}><span>WP</span><div><small>AY WORDPRESS REST API</small><h3>{healthLoading && !health ? "Kontrol ediliyor…" : health?.wordpress?.connected ? "Bağlandı" : "Bağlantı yok"}</h3><p>{health?.wordpress?.connected ? "Medya, featured image, AIOSEO ve draft aktarımı" : health?.wordpress?.error || "Medya, featured image, AIOSEO ve draft aktarımı"}</p></div></article><article className={health?.whatsapp?.connected ? "healthy" : "attention"}><span>WA</span><div><small>AY WHATSAPP</small><h3>{healthLoading && !health ? "Kontrol ediliyor…" : health?.whatsapp?.connected ? "Bağlandı" : "Numara bekliyor"}</h3><p>{health?.whatsapp?.connected ? `+90 ${health.whatsapp.phone?.slice(2, 5)} ${health.whatsapp.phone?.slice(5, 8)} ${health.whatsapp.phone?.slice(8, 10)} ${health.whatsapp.phone?.slice(10, 12)}` : "Şimdilik iletişim sayfasına yönlendirilir"}</p></div></article><article className={health?.supabase?.connected ? "healthy" : "attention"}><span>DB</span><div><small>AY DEPOLAMA</small><h3>{healthLoading && !health ? "Kontrol ediliyor…" : health?.supabase?.connected ? "Hazır" : "Yapılandırma bekliyor"}</h3><p>Projeler ve görseller <code>brand=ay-tercume</code> ile TTAA kayıtlarından ayrı tutulur</p></div></article></div></section> : null}
        </section>
      </div>
    </main>
  );
}
