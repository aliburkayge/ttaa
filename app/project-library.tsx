"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobBrand } from "../lib/jobs";
import type { GeneratedArticle } from "../lib/openai";
import { ProjectApiError, getProject, listProjects, syncProjectToWordPress, updateProjectArticle } from "../lib/projects-client";
import type { ContentProject } from "../lib/projects";
import InlineArticleEditor from "./inline-article-editor";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.round(hours / 24)} gün önce`;
}

export default function ProjectLibrary({ brand, brandLabel, initialProjectId, onProjectClosed }: {
  brand: JobBrand;
  brandLabel: string;
  initialProjectId?: string | null;
  onProjectClosed?: () => void;
}) {
  const [projects, setProjects] = useState<ContentProject[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [project, setProject] = useState<ContentProject | null>(null);
  const [draft, setDraft] = useState<GeneratedArticle | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "conflict" | "error" | "syncing" | "synced"; message?: string }>({ kind: "idle" });

  const refreshList = useCallback(async () => {
    try {
      setProjects(await listProjects(brand));
      setListError(null);
    } catch (error) {
      setListError(error instanceof ProjectApiError ? error.message : "Proje listesi alınamadı.");
    }
  }, [brand]);

  useEffect(() => {
    // Mirrors the mount-time fetch idiom used by checkIntegrations() in app/page.tsx;
    // this is a genuine "fetch on mount/brand change" effect, not a render-cascade risk.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshList();
  }, [refreshList]);

  const openProject = useCallback(async (id: string) => {
    setSelectedId(id);
    setStatus({ kind: "idle" });
    try {
      const value = await getProject(id);
      setProject(value);
      setDraft(value.content_package.preview);
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof ProjectApiError ? error.message : "Proje açılamadı." });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialProjectId) void openProject(initialProjectId);
  }, [initialProjectId, openProject]);

  const closeProject = useCallback(() => {
    setSelectedId(null);
    setProject(null);
    setDraft(null);
    setStatus({ kind: "idle" });
    onProjectClosed?.();
  }, [onProjectClosed]);

  const save = useCallback(async () => {
    if (!project || !draft) return;
    setStatus({ kind: "saving" });
    try {
      const updated = await updateProjectArticle(project.id, project.revision, draft);
      setProject(updated);
      setDraft(updated.content_package.preview);
      setStatus({ kind: "saved", message: "Değişiklikler kaydedildi." });
      void refreshList();
    } catch (error) {
      if (error instanceof ProjectApiError && error.code === "REVISION_CONFLICT") {
        setStatus({ kind: "conflict", message: "Bu proje başka bir oturumda güncellendi. Kaydetmeden önce yeniden yükleyin." });
      } else {
        setStatus({ kind: "error", message: error instanceof ProjectApiError ? error.message : "Kaydetme başarısız." });
      }
    }
  }, [project, draft, refreshList]);

  const reload = useCallback(() => {
    if (selectedId) void openProject(selectedId);
  }, [selectedId, openProject]);

  const sendToWordPress = useCallback(async () => {
    if (!project || !draft) return;
    setStatus({ kind: "saving" });
    try {
      const saved = await updateProjectArticle(project.id, project.revision, draft);
      setProject(saved);
      setDraft(saved.content_package.preview);
      setStatus({ kind: "syncing" });
      const synced = await syncProjectToWordPress(saved.id);
      setProject(synced);
      setDraft(synced.content_package.preview);
      setStatus({ kind: "synced", message: "WordPress'e gönderildi (taslak olarak güncellendi)." });
      void refreshList();
    } catch (error) {
      if (error instanceof ProjectApiError && error.code === "REVISION_CONFLICT") {
        setStatus({ kind: "conflict", message: "Bu proje başka bir oturumda güncellendi. Kaydetmeden önce yeniden yükleyin." });
      } else if (error instanceof ProjectApiError && error.status === 409) {
        setStatus({ kind: "error", message: "Bu yazı WordPress'te elle değiştirilmiş veya yayımlanmış görünüyor; otomatik güncelleme engellendi." });
      } else {
        setStatus({ kind: "error", message: error instanceof ProjectApiError ? error.message : "WordPress'e gönderilemedi." });
      }
    }
  }, [project, draft, refreshList]);

  if (selectedId && project && draft) {
    return (
      <section className="utility-view project-editor">
        <link rel="stylesheet" href={brand === "ay-tercume" ? "/ay-tercume-article.css" : "/translation-article.css"} />
        <small>{brandLabel.toUpperCase()} · PROJE DÜZENLE</small>
        <div className="live-editor-toolbar">
          <button type="button" onClick={closeProject}>← Kütüphaneye dön</button>
          <div className="editor-toolbar-actions">
            <button type="button" onClick={save} disabled={status.kind === "saving"}>
              {status.kind === "saving" ? "Kaydediliyor…" : "Taslak olarak kaydet"}
            </button>
            <button type="button" className="primary" onClick={sendToWordPress} disabled={!project.wordpress_post_id || status.kind === "saving" || status.kind === "syncing"}>
              {status.kind === "syncing" ? "Gönderiliyor…" : "WordPress'e Gönder"}
            </button>
          </div>
        </div>
        {status.message && (
          <p className={`editor-status editor-status-${status.kind}`}>
            {status.message}
            {status.kind === "conflict" && <button type="button" onClick={reload}>Yeniden yükle</button>}
          </p>
        )}
        <p style={{ maxWidth: 900, margin: "0 auto 4px", color: "var(--tt-muted)", fontSize: 12 }}>
          Metinlerin üzerine tıklayıp doğrudan düzenleyin — HTML/CSS&apos;e dokunmazsınız. Görseller değişmez. Bitince <strong>WordPress&apos;e Gönder</strong>&apos;e basın.
        </p>
        <InlineArticleEditor brand={brand} article={draft} onChange={setDraft} />
      </section>
    );
  }

  return (
    <section className="utility-view">
      <small>{brandLabel.toUpperCase()} · PROJE KÜTÜPHANESİ</small>
      <h1>Kalıcı içerik projeleriniz</h1>
      <p>Tamamlanan her üretim burada saklanır. Bir projeyi açarak metinlerin üzerine tıklayarak düzenleyebilir, sonra WordPress&apos;e gönderebilirsiniz.</p>
      {listError && <p className="editor-status editor-status-error">{listError}</p>}
      {projects === null && !listError && <p>Yükleniyor…</p>}
      {projects !== null && projects.length === 0 && <p>Henüz kaydedilmiş bir proje yok. İlk içeriğinizi oluşturun.</p>}
      {(projects || []).map((item) => (
        <div className="library-card" key={item.id}>
          <span className="file-icon">H1</span>
          <div>
            <h3>{item.title}</h3>
            <p>
              {item.wordpress_status === "draft" ? `WordPress taslağı #${item.wordpress_post_id}` : item.slug}
              {" · "}rev {item.revision}
              {" · "}{timeAgo(item.updated_at)}
            </p>
          </div>
          <button type="button" onClick={() => void openProject(item.id)}>Düzenle</button>
        </div>
      ))}
    </section>
  );
}
