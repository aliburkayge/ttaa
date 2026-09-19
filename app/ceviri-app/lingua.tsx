"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./lingua.module.css";

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
  edited?: boolean;
};

type Doc = {
  id: string;
  filename: string;
  source_lang: string;
  target_lang: string;
  stats: { paragraphs: number; tableCells: number; tables: number; images: number; words: number };
  segments: Segment[];
};

const LANGS = ["en-US", "tr-TR", "de-DE", "ru-RU", "es-ES", "it-IT", "el-GR", "pl-PL"];

function tagFor(source: string | null) {
  if (source === "tm-exact" || source === "tm-fuzzy") return { label: "BELLEK", cls: styles.tagTm };
  if (source === "engine") return { label: "MOTOR", cls: styles.tagEngine };
  if (source === "human") return { label: "DÜZELTİLDİ", cls: styles.tagTm };
  if (source === "untouched") return { label: "HATA", cls: styles.tagFail };
  return null;
}

export default function Lingua() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sourceLang, setSourceLang] = useState("en-US");
  const [targetLang, setTargetLang] = useState("tr-TR");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [ocrWarning, setOcrWarning] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [doc?.segments.length, busy]);

  const upload = useCallback(
    async (file: File) => {
      setBusy("Belge okunuyor…");
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("sourceLang", sourceLang);
        form.append("targetLang", targetLang);
        const res = await fetch("/api/ceviri/documents", { method: "POST", body: form });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Yükleme başarısız.");
        setDoc(payload.document as Doc);
        setOcrWarning(typeof payload.ocrWarning === "string" ? payload.ocrWarning : null);
        setSavedIds(new Set());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Yükleme başarısız.");
      } finally {
        setBusy(null);
      }
    },
    [sourceLang, targetLang],
  );

  async function translate(current: Doc) {
    setError(null);
    let working = current;
    try {
      for (;;) {
        const done = working.segments.filter((s) => s.translation !== null).length;
        setBusy(`Çevriliyor… ${done}/${working.segments.length}`);
        const res = await fetch(`/api/ceviri/documents/${working.id}/translate`, { method: "POST" });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Çeviri başarısız.");
        working = { ...working, segments: payload.segments as Segment[] };
        setDoc(working);
        if (payload.done) break;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Çeviri başarısız.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSegment(segmentId: string, translation: string) {
    if (!doc) return;
    try {
      const res = await fetch(`/api/ceviri/documents/${doc.id}/segments`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segmentId, translation }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Kaydedilemedi.");
      setSavedIds((previous) => new Set(previous).add(segmentId));
      setTimeout(() => {
        setSavedIds((previous) => {
          const next = new Set(previous);
          next.delete(segmentId);
          return next;
        });
      }, 2200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kaydedilemedi.");
    }
  }

  function onPick(file: File | undefined) {
    if (file) void upload(file);
  }

  const translated = doc ? doc.segments.filter((s) => s.translation !== null).length : 0;
  const total = doc?.segments.length ?? 0;
  const fromMemory = doc
    ? doc.segments.filter((s) => s.source === "tm-exact" || s.source === "tm-fuzzy").length
    : 0;
  const flagged = doc ? doc.segments.filter((s) => s.warning !== null).length : 0;
  const complete = total > 0 && translated === total;

  return (
    <div className={styles.app} lang="tr">
      <div className={styles.top}>
        <Link className={styles.mark} href="/ceviri-app">
          <span className={styles.markDot} />
          Lingua
        </Link>
        <span className={styles.topSpacer} />
        <Link className={styles.topLink} href="/ceviri-app/bellek">Bellek</Link>
        <Link className={styles.topLink} href="/">Panel</Link>
      </div>

      <div className={styles.stream} ref={streamRef}>
        <div className={styles.streamInner}>
          {!doc && (
            <div className={styles.hello}>
              <div className={styles.orb} />
              <p className={styles.helloTitle}>Merhaba, ben Lingua</p>
              <p className={styles.helloText}>
                Bir belge bırakın; çevirisini kendi belleğinizden ve terminolojinizden üreteyim.
              </p>
              <div className={styles.chips}>
                <button className={styles.chip} type="button" onClick={() => fileRef.current?.click()}>
                  Belge yükle
                </button>
                <Link className={styles.chip} href="/ceviri-app/bellek">Bellekte ara</Link>
              </div>
            </div>
          )}

          {doc && (
            <>
              <div className={`${styles.turn} ${styles.turnUser}`}>
                <div className={styles.bubbleUser}>
                  <div className={styles.fileChip}>
                    <span className={styles.fileIcon}>📄</span>
                    <span>
                      <div className={styles.fileName}>{doc.filename}</div>
                      <div className={styles.fileMeta}>
                        {doc.source_lang} → {doc.target_lang}
                      </div>
                    </span>
                  </div>
                </div>
              </div>

              <div className={`${styles.turn} ${styles.turnBot}`}>
                <span className={styles.avatar} />
                <div className={styles.botBody}>
                  {ocrWarning && (
                    <div className={styles.ocrWarn}>
                      <b>OCR bağlı değil</b>
                      <span className={styles.demoTag}>DEMO</span>
                      <div>{ocrWarning}</div>
                    </div>
                  )}
                  <p className={styles.botText}>
                    Belgeyi okudum. <b>{total}</b> çevrilecek segment buldum
                    {doc.stats.tables > 0 && <> — bunların <b>{doc.stats.tableCells}</b> tanesi tablo hücresi</>}.
                    Biçim, {doc.stats.tables} tablo ve {doc.stats.images} görsel olduğu gibi korunacak.
                  </p>

                  <div className={styles.card}>
                    <div className={styles.cardPad}>
                      <div className={styles.cardRow}>
                        <span><b>{doc.stats.words}</b> kelime</span>
                        <span><b>{doc.stats.paragraphs}</b> paragraf</span>
                        <span><b>{doc.stats.tableCells}</b> tablo hücresi</span>
                        <span><b>{doc.stats.images}</b> görsel</span>
                        {translated > 0 && <span><b>{fromMemory}</b> segment bellekten</span>}
                        {flagged > 0 && <span style={{ color: "#ad2b31" }}><b>{flagged}</b> kontrol bekliyor</span>}
                      </div>

                      {translated > 0 && (
                        <>
                          <div className={styles.bar}>
                            <div className={styles.barFill} style={{ width: `${Math.round((translated / total) * 100)}%` }} />
                          </div>
                          <div className={styles.cardRow} style={{ marginTop: 8 }}>
                            <span>{translated}/{total} segment çevrildi</span>
                          </div>
                        </>
                      )}

                      <div className={styles.actions}>
                        {!complete && (
                          <button
                            className={styles.primary}
                            type="button"
                            onClick={() => void translate(doc)}
                            disabled={busy !== null}
                          >
                            {busy ?? "Çeviriyi başlat"}
                          </button>
                        )}
                        {complete && (
                          <a className={styles.primary} href={`/api/ceviri/documents/${doc.id}/download`}>
                            Word olarak indir
                          </a>
                        )}
                        <button
                          className={styles.secondary}
                          type="button"
                          onClick={() => { setDoc(null); setError(null); setOcrWarning(null); }}
                          disabled={busy !== null}
                        >
                          Yeni belge
                        </button>
                      </div>
                    </div>
                  </div>

                  {translated > 0 && (
                    <>
                      <p className={styles.botMuted}>
                        Çeviriyi doğrudan aşağıdan düzeltebilirsiniz. Düzelttiğiniz her cümle belleğe
                        onaylanmış olarak yazılır ve bir dahaki belgede birebir kullanılır.
                      </p>
                      <div className={styles.card}>
                        <div className={styles.segHead}>
                          <span>Kaynak</span>
                          <span style={{ marginLeft: "auto" }}>Çeviri</span>
                        </div>
                        <div className={styles.segScroll}>
                          {doc.segments.map((segment, index) => {
                            const tag = tagFor(segment.source);
                            return (
                              <div className={styles.seg} key={segment.id}>
                                <div className={`${styles.segSide} ${styles.segSrc}`}>
                                  <div className={styles.segTop}>
                                    <span className={styles.segNo}>{index + 1}</span>
                                    {segment.kind === "table-cell" && (
                                      <span className={`${styles.tag} ${styles.tagTable}`}>TABLO</span>
                                    )}
                                  </div>
                                  {segment.text}
                                </div>
                                <div className={`${styles.segSide} ${styles.segDst}`}>
                                  <div className={styles.segTop}>
                                    {tag && <span className={`${styles.tag} ${tag.cls}`}>{tag.label}</span>}
                                    {segment.score !== null && segment.source !== "engine" && (
                                      <span className={styles.segNo}>%{Math.round(segment.score * 100)}</span>
                                    )}
                                    {savedIds.has(segment.id) && <span className={styles.saved}>KAYDEDİLDİ</span>}
                                  </div>
                                  {segment.translation === null ? (
                                    <span className={styles.pending}>bekliyor</span>
                                  ) : (
                                    <textarea
                                      className={styles.editable}
                                      defaultValue={segment.translation}
                                      rows={1}
                                      onBlur={(event) => {
                                        const value = event.target.value.trim();
                                        if (value && value !== segment.translation) {
                                          segment.translation = value;
                                          segment.source = "human";
                                          void saveSegment(segment.id, value);
                                        }
                                      }}
                                    />
                                  )}
                                  {segment.warning && <div className={styles.warn}>{segment.warning}</div>}
                                  {segment.note && !segment.warning && (
                                    <div className={styles.note}>{segment.note}</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}

                  {error && <div className={styles.err}>{error}</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.dock}>
        <div className={styles.dockInner}>
          <div
            className={dragging ? `${styles.composer} ${styles.composerDrag}` : styles.composer}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              onPick(event.dataTransfer.files?.[0]);
            }}
          >
            <div className={styles.composerText}>
              {busy ?? "Word (.docx) veya PDF bırakın, ya da ataç simgesine basın"}
            </div>
            <div className={styles.composerBar}>
              <input
                ref={fileRef}
                type="file"
                accept=".docx,.pdf"
                hidden
                onChange={(event) => onPick(event.target.files?.[0])}
              />
              <button
                className={styles.iconBtn}
                type="button"
                title="Belge ekle"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
              >
                📎
              </button>
              <select
                className={styles.langPick}
                value={sourceLang}
                onChange={(event) => setSourceLang(event.target.value)}
                aria-label="Kaynak dil"
                disabled={doc !== null}
              >
                {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
              </select>
              <span className={styles.model}>→</span>
              <select
                className={styles.langPick}
                value={targetLang}
                onChange={(event) => setTargetLang(event.target.value)}
                aria-label="Hedef dil"
                disabled={doc !== null}
              >
                {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
              </select>
              <span className={styles.model}>
                Bellek + OpenAI
              </span>
              <button
                className={styles.send}
                type="button"
                title="Belge seç"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
