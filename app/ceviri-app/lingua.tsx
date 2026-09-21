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
  engine?: string | null;
  alternatives?: Array<{ engine: string; text: string }>;
  /** Taranmış belgede: kaynak satır hangi sayfada ve OCR ondan emin miydi. */
  page?: number;
  ocrWarning?: string | null;
  /** Çeviri orijinal PDF'te bu satırın yerine yazılamayacaksa nedeni. */
  placement?: string | null;
  /** Yerine yazılır ama çıktıya bakılmalı (ör. harfe değen aynı renkte mühür). */
  caution?: string | null;
  edited?: boolean;
};

/** Yerleşim uyarısı yalnızca metni gerçekten değişecek satırda anlamlıdır. */
function placementWarning(segment: Segment): string | null {
  if (!segment.translation || segment.translation.trim() === segment.text.trim()) return null;
  if (segment.placement) return `Çeviri PDF'te bu satırın yerine yazılamayacak: ${segment.placement}`;
  return segment.caution ?? null;
}

type EngineStatus = { id: string; label: string; on: boolean };

const ENGINE_LABELS: Record<string, string> = { openai: "OpenAI", deepl: "DeepL", gemini: "Gemini" };

type ChatMessage = { role: "user" | "assistant"; content: string; at: string };

type Doc = {
  id: string;
  filename: string;
  source_lang: string;
  target_lang: string;
  stats: {
    paragraphs: number;
    tableCells: number;
    tables: number;
    images: number;
    words: number;
    pages?: number;
  };
  segments: Segment[];
  instructions?: string | null;
  chat?: ChatMessage[] | null;
};

const LANGS = ["en-US", "tr-TR", "de-DE", "ru-RU", "es-ES", "it-IT", "el-GR", "pl-PL"];

function tagFor(source: string | null, engine?: string | null) {
  if (source === "tm-exact" || source === "tm-fuzzy") return { label: "BELLEK", cls: styles.tagTm };
  if (source === "engine") {
    const label = engine ? (ENGINE_LABELS[engine] ?? engine).toLocaleUpperCase("tr") : "MOTOR";
    return { label, cls: styles.tagEngine };
  }
  if (source === "human") return { label: "DÜZELTİLDİ", cls: styles.tagTm };
  if (source === "untouched") return { label: "HATA", cls: styles.tagFail };
  return null;
}

/**
 * Hangi motorun gerçekten çalıştığı, sunucudaki anahtarlardan okunur. Bu şerit
 * süs değil: resmi bir evrakın hangi kaynaktan çıktığı sorulduğunda cevabı
 * ekranda durmalı.
 */
export default function Lingua({ engines }: { engines: EngineStatus[] }) {
  const strip = [
    { label: "Çeviri belleği", on: true },
    { label: "Terminoloji", on: true },
    ...engines.map((engine) => ({ label: engine.label, on: engine.on })),
  ];
  const route = ["Bellek", engines.filter((e) => e.on).map((e) => e.label).join(" + ")]
    .filter(Boolean)
    .join(" → ");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sourceLang, setSourceLang] = useState("en-US");
  const [targetLang, setTargetLang] = useState("tr-TR");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [ocrWarning, setOcrWarning] = useState<string | null>(null);
  const [ocrDemo, setOcrDemo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [doc?.segments.length, chat.length, busy, thinking]);

  function grow(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }

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
        const uploaded = payload.document as Doc;
        setDoc(uploaded);
        setChat(uploaded.chat ?? []);
        setInstructions(uploaded.instructions ?? null);
        setOcrWarning(typeof payload.ocrWarning === "string" ? payload.ocrWarning : null);
        setOcrDemo(payload.ocrDemo === true);
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

  /**
   * Serbest metin mesajı. Belge yoksa sunucuya hiç gitmez — cevap zaten
   * bellidir ve bir API çağrısına gerek yoktur.
   */
  async function send() {
    const message = draft.trim();
    if (!message || thinking) return;
    const now = new Date().toISOString();
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    if (!doc) {
      setChat((previous) => [
        ...previous,
        { role: "user", content: message, at: now },
        {
          role: "assistant",
          content:
            "Önce bir belge yükleyin — ataç simgesine basın ya da .docx / .pdf dosyasını buraya bırakın. " +
            "Belge geldikten sonra nasıl çevrileceğini buradan anlatabilirsiniz.",
          at: now,
        },
      ]);
      return;
    }

    setChat((previous) => [...previous, { role: "user", content: message, at: now }]);
    setThinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/ceviri/documents/${doc.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Sohbet başarısız.");

      setChat((previous) => [
        ...previous,
        { role: "assistant", content: String(payload.reply), at: new Date().toISOString() },
      ]);
      if (typeof payload.instructions === "string") setInstructions(payload.instructions);

      const next = { ...doc, segments: payload.segments as Segment[] };
      setDoc(next);
      if (payload.retranslate && payload.cleared > 0) await translate(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sohbet başarısız.");
    } finally {
      setThinking(false);
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

  /**
   * Seçilmeyen motorun metnini kabul etmek bir inceleme kararıdır; elle
   * düzeltme gibi belleğe onaylı çeviri olarak yazılır.
   */
  function adopt(segmentId: string, text: string) {
    setDoc((current) =>
      current && {
        ...current,
        segments: current.segments.map((segment) =>
          segment.id === segmentId
            ? { ...segment, translation: text, source: "human", warning: null, alternatives: [] }
            : segment,
        ),
      },
    );
    void saveSegment(segmentId, text);
  }

  function onPick(file: File | undefined) {
    if (file) void upload(file);
  }

  function reset() {
    setDoc(null);
    setChat([]);
    setInstructions(null);
    setError(null);
    setOcrWarning(null);
  }

  const translated = doc ? doc.segments.filter((s) => s.translation !== null).length : 0;
  const total = doc?.segments.length ?? 0;
  const fromMemory = doc
    ? doc.segments.filter((s) => s.source === "tm-exact" || s.source === "tm-fuzzy").length
    : 0;
  const flagged = doc ? doc.segments.filter((s) => s.warning !== null).length : 0;
  const ocrFlagged = doc ? doc.segments.filter((s) => s.ocrWarning).length : 0;
  const isScan = doc ? doc.filename.toLowerCase().endsWith(".pdf") : false;
  const complete = total > 0 && translated === total;
  const working = busy !== null || thinking;

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
                Bir belge bırakın. Önce kendi çeviri belleğinize ve terminolojinize bakarım;
                bellekte olmayan cümleleri {engines.filter((e) => e.on).map((e) => e.label).join(" ve ")}{" "}
                ile çevirip kurallara en uygun olanı seçerim. Sonrasında nasıl çevrilmesini
                istediğinizi buradan anlatabilirsiniz.
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
                      <b>{ocrDemo ? "OCR bağlı değil" : "OCR notu"}</b>
                      {ocrDemo && <span className={styles.demoTag}>DEMO</span>}
                      <div>{ocrWarning}</div>
                    </div>
                  )}
                  <p className={styles.botText}>
                    {isScan ? (
                      <>
                        Taranmış belgeyi okudum: <b>{doc.stats.pages}</b> sayfa, <b>{total}</b> çevrilecek satır
                        {doc.stats.tables > 0 && <> — <b>{doc.stats.tableCells}</b> tanesi tablo hücresi</>}.
                        Çeviri orijinal PDF&apos;in üstüne, her satırın kendi yerine yazılacak; logo, tablo,
                        fotoğraf, imza ve mühür olduğu gibi kalır.
                      </>
                    ) : (
                      <>
                        Belgeyi okudum. <b>{total}</b> çevrilecek segment buldum
                        {doc.stats.tables > 0 && <> — bunların <b>{doc.stats.tableCells}</b> tanesi tablo hücresi</>}.
                        Biçim, {doc.stats.tables} tablo ve {doc.stats.images} görsel olduğu gibi korunacak.
                      </>
                    )}
                  </p>
                  {ocrFlagged > 0 && (
                    <p className={styles.botMuted}>
                      <b>{ocrFlagged}</b> satırda OCR emin değildi ya da metin bir görselin içinden okundu;
                      bunları kaynak sütununda sarıyla işaretledim. Aslıyla karşılaştırın.
                    </p>
                  )}
                  <p className={styles.botMuted}>
                    Çeviriyi başlatabilir ya da önce nasıl çevrilmesini istediğinizi yazabilirsiniz.
                  </p>

                  <div className={styles.engines}>
                    {strip.map((engine) => (
                      <span
                        key={engine.label}
                        className={engine.on ? styles.engineOn : styles.engineOff}
                      >
                        {engine.on ? "●" : "○"} {engine.label}
                        {!engine.on && " · anahtar yok"}
                      </span>
                    ))}
                  </div>

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
                            disabled={working}
                          >
                            {busy ?? "Çeviriyi başlat"}
                          </button>
                        )}
                        {complete && (
                          <a className={styles.primary} href={`/api/ceviri/documents/${doc.id}/download`}>
                            {isScan ? "PDF olarak indir" : "Word olarak indir"}
                          </a>
                        )}
                        <button
                          className={styles.secondary}
                          type="button"
                          onClick={reset}
                          disabled={working}
                        >
                          Yeni belge
                        </button>
                      </div>
                    </div>
                  </div>

                  {instructions && (
                    <div className={styles.instruction}>
                      <span className={styles.instructionHead}>BU BELGE İÇİN TALİMATINIZ</span>
                      {instructions}
                    </div>
                  )}

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
                            const tag = tagFor(segment.source, segment.engine);
                            return (
                              <div className={styles.seg} key={segment.id}>
                                <div className={`${styles.segSide} ${styles.segSrc}`}>
                                  <div className={styles.segTop}>
                                    <span className={styles.segNo}>{index + 1}</span>
                                    {segment.kind === "table-cell" && (
                                      <span className={`${styles.tag} ${styles.tagTable}`}>TABLO</span>
                                    )}
                                    {segment.page !== undefined && (
                                      <span className={styles.segNo}>s. {segment.page}</span>
                                    )}
                                  </div>
                                  {segment.text}
                                  {segment.ocrWarning && <div className={styles.ocrLine}>{segment.ocrWarning}</div>}
                                  {placementWarning(segment) && (
                                    <div className={styles.ocrLine}>{placementWarning(segment)}</div>
                                  )}
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
                                      key={`${segment.id}-${segment.translation}`}
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
                                  {segment.source === "engine" &&
                                    segment.alternatives?.map((alternative) => (
                                      <div className={styles.alt} key={alternative.engine}>
                                        <span className={styles.altHead}>
                                          {ENGINE_LABELS[alternative.engine] ?? alternative.engine} önerisi
                                        </span>
                                        <span className={styles.altText}>{alternative.text}</span>
                                        <button
                                          className={styles.altUse}
                                          type="button"
                                          onClick={() => adopt(segment.id, alternative.text)}
                                        >
                                          Bunu kullan
                                        </button>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {chat.map((message, index) =>
            message.role === "user" ? (
              <div className={`${styles.turn} ${styles.turnUser}`} key={`${message.at}-${index}`}>
                <div className={styles.bubbleUser}>{message.content}</div>
              </div>
            ) : (
              <div className={`${styles.turn} ${styles.turnBot}`} key={`${message.at}-${index}`}>
                <span className={styles.avatar} />
                <div className={styles.botBody}>
                  <p className={styles.chatText}>{message.content}</p>
                </div>
              </div>
            ),
          )}

          {thinking && (
            <div className={`${styles.turn} ${styles.turnBot}`}>
              <span className={styles.avatar} />
              <div className={styles.botBody}>
                <p className={styles.typing}>Düşünüyorum…</p>
              </div>
            </div>
          )}

          {error && (
            <div className={`${styles.turn} ${styles.turnBot}`}>
              <span className={styles.avatar} />
              <div className={styles.botBody}>
                <div className={styles.err}>{error}</div>
              </div>
            </div>
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
            {busy && <div className={styles.busyLine}>{busy}</div>}
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={1}
              value={draft}
              placeholder={
                doc
                  ? "Nasıl çevrilmesini istersiniz? Ya da belge hakkında bir şey sorun…"
                  : "Word (.docx) veya PDF bırakın, ya da ataç simgesine basın…"
              }
              onChange={(event) => { setDraft(event.target.value); grow(event.target); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
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
                disabled={working}
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
              <span
                className={styles.model}
                title="Önce çeviri belleği; bellekte olmayan cümleler açık motorlara gider, kurallara göre biri seçilir."
              >
                {route}
              </span>
              <button
                className={styles.send}
                type="button"
                title={draft.trim() ? "Gönder" : "Belge seç"}
                onClick={() => (draft.trim() ? void send() : fileRef.current?.click())}
                disabled={working}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
