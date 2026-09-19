"use client";

import { useCallback, useRef, useState } from "react";
import styles from "./ceviri.module.css";

type Segment = {
  id: string;
  text: string;
  kind: "paragraph" | "table-cell";
  order: number;
  translation: string | null;
  source: string | null;
  score: number | null;
  note: string | null;
  warning: string | null;
};

type DocumentState = {
  id: string;
  filename: string;
  source_lang: string;
  target_lang: string;
  stats: { paragraphs: number; tableCells: number; tables: number; images: number; words: number };
  segments: Segment[];
};

const LANGS = ["en-US", "tr-TR", "de-DE", "ru-RU", "es-ES", "it-IT", "el-GR", "pl-PL"];

function badgeFor(source: string | null) {
  if (source === "tm-exact" || source === "tm-fuzzy") {
    return { label: "BELLEKTEN", className: styles.badgeTm };
  }
  if (source === "engine") return { label: "MOTOR", className: styles.badgeEngine };
  if (source === "untouched") return { label: "BAŞARISIZ", className: styles.badgeFail };
  return null;
}

export default function Workspace() {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sourceLang, setSourceLang] = useState("en-US");
  const [targetLang, setTargetLang] = useState("tr-TR");
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setBusy("Belge okunuyor…");
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("sourceLang", sourceLang);
        form.append("targetLang", targetLang);
        const response = await fetch("/api/ceviri/documents", { method: "POST", body: form });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Yükleme başarısız.");
        setDoc(payload.document as DocumentState);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Yükleme başarısız.");
      } finally {
        setBusy(null);
      }
    },
    [sourceLang, targetLang],
  );

  async function translate() {
    if (!doc) return;
    setError(null);
    try {
      for (;;) {
        const remainingBefore = doc.segments.filter((s) => s.translation === null).length;
        setBusy(`Çevriliyor… ${doc.segments.length - remainingBefore}/${doc.segments.length}`);
        const response = await fetch(`/api/ceviri/documents/${doc.id}/translate`, { method: "POST" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Çeviri başarısız.");
        doc.segments = payload.segments as Segment[];
        setDoc({ ...doc });
        if (payload.done) break;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Çeviri başarısız.");
    } finally {
      setBusy(null);
    }
  }

  if (!doc) {
    return (
      <>
        <div
          className={dragging ? `${styles.drop} ${styles.dropActive}` : styles.drop}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
        >
          <div className={styles.dropIcon}>📄</div>
          <p className={styles.dropTitle}>Belgeyi buraya bırakın</p>
          <p className={styles.dropHint}>
            Word belgesi (.docx) · en fazla 25 MB · biçim, tablolar ve logolar korunur
          </p>

          <div className={styles.controls} style={{ justifyContent: "center" }}>
            <select
              className={styles.select}
              value={sourceLang}
              onChange={(event) => setSourceLang(event.target.value)}
              aria-label="Kaynak dil"
            >
              {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
            </select>
            <span className={styles.arrow}>→</span>
            <select
              className={styles.select}
              value={targetLang}
              onChange={(event) => setTargetLang(event.target.value)}
              aria-label="Hedef dil"
            >
              {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
            </select>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".docx"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <button className={styles.pick} type="button" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
            {busy ?? "Dosya seç"}
          </button>

          <div className={styles.notice}>
            PDF ve taranmış belgeler için OCR servisi henüz bağlanmadı — şimdilik .docx
          </div>
        </div>
        {error && <p className={styles.alert} role="alert">{error}</p>}
      </>
    );
  }

  const translated = doc.segments.filter((segment) => segment.translation !== null).length;
  const total = doc.segments.length;
  const fromMemory = doc.segments.filter(
    (segment) => segment.source === "tm-exact" || segment.source === "tm-fuzzy",
  ).length;
  const flagged = doc.segments.filter((segment) => segment.warning !== null).length;
  const complete = translated === total;

  return (
    <>
      <div className={styles.docCard}>
        <div className={styles.docTop}>
          <span className={styles.docName}>{doc.filename}</span>
          <button className={styles.ghost} type="button" onClick={() => setDoc(null)} disabled={busy !== null}>
            Yeni belge
          </button>
          {complete ? (
            <a className={styles.pick} href={`/api/ceviri/documents/${doc.id}/download`}>
              Word olarak indir
            </a>
          ) : (
            <button className={styles.pick} type="button" onClick={() => void translate()} disabled={busy !== null}>
              {busy ?? "Çeviriyi başlat"}
            </button>
          )}
        </div>

        <div className={styles.docMeta}>
          <span>{doc.source_lang} → {doc.target_lang}</span>
          <span><b>{total}</b> segment</span>
          <span><b>{doc.stats.words}</b> kelime</span>
          <span><b>{doc.stats.tables}</b> tablo</span>
          <span><b>{doc.stats.images}</b> görsel korunuyor</span>
          {translated > 0 && <span><b>{fromMemory}</b> segment bellekten geldi</span>}
          {flagged > 0 && <span style={{ color: "#97282f" }}><b>{flagged}</b> segment işaretli</span>}
        </div>

        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${Math.round((translated / total) * 100)}%` }} />
        </div>
        <div className={styles.barLabel}>
          {translated}/{total} segment çevrildi
          {complete && " · biçim, tablolar ve görseller korundu"}
        </div>
      </div>

      {error && <p className={styles.alert} role="alert">{error}</p>}

      <div className={styles.segments}>
        {doc.segments.map((segment, index) => {
          const badge = badgeFor(segment.source);
          return (
            <div className={styles.segRow} key={segment.id}>
              <div className={`${styles.segCell} ${styles.segSource}`}>
                <div className={styles.cellHead}>
                  <span className={styles.segIndex}>{index + 1}</span>
                  {segment.kind === "table-cell" && <span className={styles.kind}>TABLO</span>}
                </div>
                {segment.text}
              </div>
              <div className={`${styles.segCell} ${styles.segTarget}`}>
                <div className={styles.cellHead}>
                  {badge && <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>}
                  {segment.score !== null && segment.source !== "engine" && (
                    <span className={styles.segIndex}>%{Math.round(segment.score * 100)}</span>
                  )}
                </div>
                {segment.translation === null ? (
                  <span className={styles.segPending}>bekliyor</span>
                ) : (
                  segment.translation
                )}
                {segment.warning && <div className={styles.segWarn}>{segment.warning}</div>}
                {segment.note && <div className={styles.segNote}>{segment.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
