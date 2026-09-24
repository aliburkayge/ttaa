"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryItem } from "../../lib/ceviri/library";
import { markLabels, markNote, type MarkKind } from "../../lib/ceviri/marks";
import { AllDocsCard, DocCard, QuickView } from "./doc-card";
import FirmPicker, { type ClientOption } from "./firm-picker";
import LanguagePicker from "./language-picker";
import cards from "./library.module.css";
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
  /** İmza/mühür bölgesinin içinden okunan satır: çıktıda etiketle birlikte yazılır. */
  mark?: MarkKind | null;
  edited?: boolean;
};

/** Yerleşim uyarısı yalnızca metni gerçekten değişecek satırda anlamlıdır. */
function placementWarning(segment: Segment): string | null {
  // İmzanın yazı gibi okunmuş hâli: çevirisi ne olursa olsun çıktıya yazılmaz.
  if (segment.placement?.startsWith("İmzanın kendisi")) return segment.placement;
  if (!segment.translation || segment.translation.trim() === segment.text.trim()) return null;
  if (segment.placement) return `Çeviri PDF'te bu satırın yerine yazılamayacak: ${segment.placement}`;
  return segment.caution ?? null;
}

type EngineStatus = { id: string; label: string; on: boolean };

const ENGINE_LABELS: Record<string, string> = { openai: "OpenAI", deepl: "DeepL", gemini: "Gemini" };

type ChatMessage = { role: "user" | "assistant"; content: string; at: string };

/** Firma tespiti (spec 5.2): otomatik, tahmin, sor ya da elle seçildi. */
type Detection = {
  decision: "auto" | "suggest" | "ask" | "manual";
  clientId: string | null;
  makerId: string | null;
  candidates?: Array<{ clientId: string; score: number; reasons: string[] }>;
};

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
    signatures?: number;
    stamps?: number;
  };
  segments: Segment[];
  instructions?: string | null;
  chat?: ChatMessage[] | null;
  /** Müşteri: terimce ve bellek önce bu firmanınki. */
  client_id?: string | null;
  /** Üretici: belgede ürünü geçen firma, ikinci öncelik. */
  maker_id?: string | null;
  detection?: Detection | null;
};

/** Ana sayfada gösterilen son belge sayısı; hepsi kütüphanede. */
const RECENT = 5;

/** Kabul edilen dosyalar: Word, PDF ve görsel. Çıktı her zaman aynı biçimde döner. */
const ACCEPT = ".docx,.pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff";

function outputKind(filename: string): "word" | "pdf" | "image" {
  const name = filename.toLowerCase();
  if (name.endsWith(".docx")) return "word";
  if (name.endsWith(".pdf")) return "pdf";
  return "image";
}

/** Belgenin kimliği adres çubuğunda durur: sayfa yenilense ya da geri gelinse iş kaldığı yerden sürer. */
function rememberDocument(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("belge", id);
  else url.searchParams.delete("belge");
  window.history.replaceState(null, "", url);
}

function filenameFrom(disposition: string | null, fallback: string): string {
  const match = disposition ? /filename\*=UTF-8''([^;]+)/i.exec(disposition) : null;
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return fallback;
  }
}

function tagFor(source: string | null, engine?: string | null) {
  if (source === "tm-exact" || source === "tm-fuzzy") return { label: "BELLEK", cls: styles.tagTm };
  if (source === "engine") {
    const label = engine ? (ENGINE_LABELS[engine] ?? engine).toLocaleUpperCase("tr") : "MOTOR";
    return { label, cls: styles.tagEngine };
  }
  if (source === "human") return { label: "DÜZELTİLDİ", cls: styles.tagTm };
  if (source === "rule") return { label: "ADRES", cls: styles.tagTable };
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
  const [recent, setRecent] = useState<LibraryItem[] | null>(null);
  const [libraryCount, setLibraryCount] = useState(0);
  const [peek, setPeek] = useState<LibraryItem | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [downloading, setDownloading] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [firm, setFirm] = useState("auto");
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [doc?.segments.length, chat.length, busy, thinking]);

  const show = useCallback((payload: { document: Doc; ocrWarning?: unknown; ocrDemo?: unknown }) => {
    const opened = payload.document;
    setDoc(opened);
    setChat(opened.chat ?? []);
    setInstructions(opened.instructions ?? null);
    setOcrWarning(typeof payload.ocrWarning === "string" ? payload.ocrWarning : null);
    setOcrDemo(payload.ocrDemo === true);
    setSavedIds(new Set());
    rememberDocument(opened.id);
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch(`/api/ceviri/documents?limit=${RECENT}`);
      const payload = await res.json();
      if (res.ok) {
        setRecent(payload.documents as LibraryItem[]);
        setLibraryCount(Number(payload.count) || 0);
        setNow(new Date());
      }
    } catch {
      setRecent([]);
    }
  }, []);

  const open = useCallback(
    async (id: string) => {
      setBusy("Belge açılıyor…");
      setError(null);
      try {
        const res = await fetch(`/api/ceviri/documents/${id}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Belge açılamadı.");
        show(payload);
      } catch (cause) {
        rememberDocument(null);
        setError(cause instanceof Error ? cause.message : "Belge açılamadı.");
      } finally {
        setBusy(null);
      }
    },
    [show],
  );

  // Açılışta: adres çubuğunda bir belge varsa onu aç; son belgeler her zaman listelenir.
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("belge");
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (id) await open(id);
      await loadRecent();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadRecent]);

  // Firma listesi: yükleme seçicisi ve belge rozeti için.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/ceviri/clients");
        const payload = await res.json();
        if (res.ok) setClients(payload.clients as ClientOption[]);
      } catch {
        setClients([]);
      }
    })();
  }, []);

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
        form.append("clientId", firm);
        const res = await fetch("/api/ceviri/documents", { method: "POST", body: form });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Yükleme başarısız.");
        show(payload);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Yükleme başarısız.");
      } finally {
        setBusy(null);
      }
    },
    [sourceLang, targetLang, firm, show],
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

  const clientName = (id: string | null | undefined) => clients.find((client) => client.id === id)?.name ?? null;

  /** Firmayı değiştirir; çevrilmiş satırlar varsa yeni firmaya göre yeniden çevirmeyi önerir. */
  async function changeFirm(current: Doc, value: string) {
    const clientId = value === "none" ? null : value;
    const translatedByMachine = current.segments.some((s) => s.translation !== null && s.source !== "human");
    const retranslate =
      translatedByMachine &&
      window.confirm(
        "Firma değişti. Çevrilmiş satırlar bu firmanın terimcesi ve belleğiyle yeniden çevrilsin mi? (Düzelttikleriniz korunur.)",
      );
    setError(null);
    try {
      const res = await fetch(`/api/ceviri/documents/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, retranslate }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Firma değiştirilemedi.");
      const updated = { ...current, ...(payload.document as Doc) };
      setDoc(updated);
      if (retranslate) await translate(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firma değiştirilemedi.");
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
            "Önce bir belge yükleyin — ataç simgesine basın ya da Word, PDF ya da görsel dosyasını buraya bırakın. " +
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
    rememberDocument(null);
    void loadRecent();
  }

  /**
   * İndirme sayfanın içinden yapılır: hata olursa tarayıcı bir JSON sayfasına
   * gitmez, sohbette gösterilir ve belge ekranda kalır. Başarılı indirmeden
   * sonra belge yeniden okunur; sayfa planı indirme sırasında yeniden
   * çıkarıldıysa satır uyarıları da tazelenir.
   */
  async function download() {
    if (!doc || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ceviri/documents/${doc.id}/download`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? "İndirme başarısız.");
      }
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filenameFrom(res.headers.get("content-disposition"), doc.filename);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      const fresh = await fetch(`/api/ceviri/documents/${doc.id}`);
      if (fresh.ok) {
        const payload = await fresh.json();
        setDoc((current) =>
          current && current.id === doc.id ? { ...current, segments: payload.document.segments } : current,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "İndirme başarısız.");
    } finally {
      setDownloading(false);
    }
  }

  const translated = doc ? doc.segments.filter((s) => s.translation !== null).length : 0;
  const total = doc?.segments.length ?? 0;
  const fromMemory = doc
    ? doc.segments.filter((s) => s.source === "tm-exact" || s.source === "tm-fuzzy").length
    : 0;
  const flagged = doc ? doc.segments.filter((s) => s.warning !== null).length : 0;
  const ocrFlagged = doc ? doc.segments.filter((s) => s.ocrWarning).length : 0;
  const kind = doc ? outputKind(doc.filename) : null;
  const labels = markLabels(doc?.target_lang ?? targetLang);
  const isScan = kind === "pdf" || kind === "image";
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
        <Link className={styles.topLink} href="/ceviri-app/firmalar">Firmalar</Link>
        <Link className={styles.topLink} href="/ceviri-app/kutuphane">Kütüphane</Link>
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
              {recent && recent.length > 0 && (
                <div className={`${cards.tokens} ${cards.recent}`}>
                  <div className={cards.recentHead}>
                    <b>Kaldığınız yerden devam edin</b>
                    <span>son {Math.min(RECENT, recent.length)} belge</span>
                    <Link className={cards.all} href="/ceviri-app/kutuphane">
                      Kütüphane <i>→</i>
                    </Link>
                  </div>
                  <div className={cards.row}>
                    {recent.slice(0, RECENT).map((item, index) => (
                      <DocCard
                        key={item.id}
                        doc={item}
                        index={index}
                        now={now}
                        onOpen={(picked) => {
                          if (busy === null) void open(picked.id);
                        }}
                        onPeek={setPeek}
                      />
                    ))}
                    <AllDocsCard count={libraryCount} index={Math.min(RECENT, recent.length)} />
                  </div>
                </div>
              )}
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
                        {kind === "image" ? "Görseli" : "Taranmış belgeyi"} okudum: <b>{doc.stats.pages}</b> sayfa, <b>{total}</b> çevrilecek satır
                        {doc.stats.tables > 0 && <> — <b>{doc.stats.tableCells}</b> tanesi tablo hücresi</>}.
                        Çeviri orijinal {kind === "image" ? "görselin" : "PDF'in"} üstüne, her satırın kendi
                        yerine yazılacak; logo, tablo ve fotoğraf olduğu gibi kalır. İmza ve mühürler
                        kopyalanmaz, yerlerine [{labels.signature}] ve [{labels.stamp}] yazılır.
                      </>
                    ) : (
                      <>
                        Belgeyi okudum. <b>{total}</b> çevrilecek segment buldum
                        {doc.stats.tables > 0 && <> — bunların <b>{doc.stats.tableCells}</b> tanesi tablo hücresi</>}.
                        Biçim ve tablolar olduğu gibi korunacak; imza ve mühür görsellerinin yerine
                        [{labels.signature}] ve [{labels.stamp}] yazılır, diğer görseller kalır.
                      </>
                    )}
                  </p>
                  {doc.detection?.decision === "ask" ? (
                    <div className={styles.firmAsk}>
                      <b>Bu belgenin firmasını tanıyamadım.</b>
                      <span>Çeviriden önce seçin — terimce ve bellek buna göre kullanılır.</span>
                      <FirmPicker
                        allowAuto={false}
                        value="none"
                        label="Firma"
                        clients={clients}
                        disabled={working}
                        onChange={(value) => void changeFirm(doc, value)}
                      />
                      <button className={styles.secondary} type="button" disabled={working} onClick={() => void changeFirm(doc, "none")}>
                        Genel ile devam
                      </button>
                    </div>
                  ) : (
                    <div className={styles.firmLine}>
                      <span>
                        Firma: <b>{clientName(doc.client_id) ?? "Genel"}</b>
                        {doc.maker_id && (
                          <>
                            {" "}· Üretici: <b>{clientName(doc.maker_id) ?? "—"}</b>
                          </>
                        )}
                      </span>
                      {doc.detection && doc.detection.decision !== "manual" && (
                        <span className={styles.firmWhy}>
                          {doc.detection.decision === "auto" ? "otomatik" : "tahmin — kontrol edin"}
                          {doc.detection.candidates?.[0]?.reasons.length
                            ? `: ${doc.detection.candidates[0].reasons.join(" · ")}`
                            : ""}
                        </span>
                      )}
                      <FirmPicker
                        allowAuto={false}
                        value={doc.client_id ?? "none"}
                        label="Değiştir"
                        clients={clients}
                        disabled={working}
                        onChange={(value) => void changeFirm(doc, value)}
                      />
                    </div>
                  )}
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
                        {(doc.stats.signatures ?? 0) + (doc.stats.stamps ?? 0) > 0 && (
                          <span>
                            <b>{doc.stats.signatures ?? 0}</b> imza, <b>{doc.stats.stamps ?? 0}</b> mühür etiketlenecek
                          </span>
                        )}
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
                            disabled={working || doc.detection?.decision === "ask"}
                          >
                            {busy ?? "Çeviriyi başlat"}
                          </button>
                        )}
                        {complete && (
                          <button
                            className={styles.primary}
                            type="button"
                            onClick={() => void download()}
                            disabled={working || downloading}
                          >
                            {downloading
                              ? "Hazırlanıyor…"
                              : kind === "pdf"
                                ? "PDF olarak indir"
                                : kind === "image"
                                  ? "Görsel olarak indir"
                                  : "Word olarak indir"}
                          </button>
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
                                  {segment.mark && <div className={styles.note}>{markNote(segment.mark, doc.target_lang)}</div>}
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
            <span className={styles.glow} aria-hidden="true" />
            <span className={styles.ring} aria-hidden="true">
              <span />
            </span>
            {busy && <div className={styles.busyLine}>{busy}</div>}
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={1}
              value={draft}
              placeholder={
                doc
                  ? "Nasıl çevrilmesini istersiniz? Ya da belge hakkında bir şey sorun…"
                  : "Word, PDF ya da görsel (JPG, PNG) bırakın, ya da ataç simgesine basın…"
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
                accept={ACCEPT}
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
              <div className={cards.tokens} style={{ display: "contents" }}>
                <LanguagePicker label="Kaynak dil" value={sourceLang} onChange={setSourceLang} disabled={doc !== null} />
                <button
                  className={swapped ? `${cards.swap} ${cards.swapTurned}` : cards.swap}
                  type="button"
                  title="Dilleri değiştir"
                  aria-label="Kaynak ve hedef dili değiştir"
                  disabled={doc !== null}
                  onClick={() => {
                    setSourceLang(targetLang);
                    setTargetLang(sourceLang);
                    setSwapped((current) => !current);
                  }}
                >
                  ⇄
                </button>
                <LanguagePicker label="Hedef dil" value={targetLang} onChange={setTargetLang} disabled={doc !== null} />
              </div>
              <FirmPicker value={firm} onChange={setFirm} clients={clients} disabled={doc !== null} />
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
      {peek && (
        <QuickView
          doc={peek}
          onClose={() => setPeek(null)}
          onOpen={(picked) => {
            setPeek(null);
            void open(picked.id);
          }}
        />
      )}
    </div>
  );
}
