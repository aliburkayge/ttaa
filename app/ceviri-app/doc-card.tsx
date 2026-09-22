"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { languageLabel } from "../../lib/ceviri/languages";
import { whenLabel, type LibraryItem } from "../../lib/ceviri/library";
import { Flag } from "./language-picker";
import styles from "./library.module.css";

const BADGES: Record<LibraryItem["kind"], { label: string; cls: string }> = {
  pdf: { label: "PDF", cls: styles.badgePdf },
  word: { label: "WORD", cls: styles.badgeWord },
  image: { label: "GÖRSEL", cls: styles.badgeImage },
};

export function thumbnailUrl(id: string, width: number): string {
  return `/api/ceviri/documents/${id}/thumbnail?w=${width}`;
}

function progress(doc: LibraryItem): number {
  return doc.total ? doc.translated / doc.total : 0;
}

function Ring({ value }: { value: number }) {
  const length = 2 * Math.PI * 10;
  return (
    <svg className={styles.ring} viewBox="0 0 26 26" aria-label={`%${Math.round(value * 100)} çevrildi`}>
      <circle cx="13" cy="13" r="12" fill="rgba(255,255,255,.95)" />
      <circle cx="13" cy="13" r="10" fill="none" stroke="#ececf0" strokeWidth="3" />
      <circle
        cx="13"
        cy="13"
        r="10"
        fill="none"
        stroke="#8f7cf0"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${length * value} ${length}`}
        transform="rotate(-90 13 13)"
      />
    </svg>
  );
}

/** Belgenin ilk sayfası: PDF ve görselde çizilmiş önizleme, Word'de ilk satırları. */
export function PagePreview({ doc, width, className }: { doc: LibraryItem; width: number; className?: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  if (doc.kind === "word" || state === "failed") {
    const [title, ...rest] = doc.preview;
    return (
      <div className={`${className ?? styles.page} ${title ? styles.wordPage : styles.blankPage}`}>
        {title ? (
          <>
            <b>{title}</b>
            {rest.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </>
        ) : (
          "📄"
        )}
      </div>
    );
  }
  return (
    <div className={`${className ?? styles.page} ${state === "loading" ? styles.pageLoading : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- önizleme oturumlu API'den gelir */}
      <img
        src={thumbnailUrl(doc.id, width)}
        alt=""
        loading="lazy"
        decoding="async"
        className={state === "loaded" ? styles.loaded : undefined}
        onLoad={(event) => setState(event.currentTarget.naturalWidth > 1 ? "loaded" : "failed")}
        onError={() => setState("failed")}
      />
    </div>
  );
}

export function LangPair({ doc }: { doc: LibraryItem }) {
  return (
    <span className={styles.langs} title={`${languageLabel(doc.source_lang)} → ${languageLabel(doc.target_lang)}`}>
      <Flag code={doc.source_lang} />→<Flag code={doc.target_lang} />
    </span>
  );
}

/**
 * Kütüphane kartı: ilk sayfanın önizlemesi, tür rozeti, çeviri durumu
 * (tamamsa ✓, değilse ilerleme halkası). Üzerine gelince "Aç" ve hızlı bakış.
 */
export function DocCard({
  doc,
  index,
  now,
  onOpen,
  onPeek,
}: {
  doc: LibraryItem;
  index: number;
  now: Date;
  onOpen: (doc: LibraryItem) => void;
  onPeek: (doc: LibraryItem) => void;
}) {
  const done = doc.total > 0 && doc.translated === doc.total;
  const badge = BADGES[doc.kind];
  return (
    <div
      className={styles.card}
      style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
      role="button"
      tabIndex={0}
      aria-label={`${doc.filename} belgesini aç`}
      onClick={() => onOpen(doc)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(doc);
        if (event.key === " ") {
          event.preventDefault();
          onPeek(doc);
        }
      }}
    >
      <div className={styles.stackBack} />
      <div className={styles.thumb}>
        <PagePreview doc={doc} width={360} />
        <span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span>
        {done ? <span className={styles.done}>✓</span> : <Ring value={progress(doc)} />}
        <div className={styles.hover}>
          <button
            className={styles.hoverOpen}
            type="button"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(doc);
            }}
          >
            {done ? "Aç" : doc.translated ? "Devam et" : "Başlat"}
          </button>
          <button
            className={styles.hoverPeek}
            type="button"
            title="Hızlı bakış"
            aria-label="Hızlı bakış"
            onClick={(event) => {
              event.stopPropagation();
              onPeek(doc);
            }}
          >
            👁
          </button>
        </div>
      </div>
      <div className={styles.meta}>
        <div className={styles.name} title={doc.filename}>
          {doc.filename}
        </div>
        <div className={styles.sub}>
          <LangPair doc={doc} />
          {whenLabel(doc.created_at, now)}
          {!done && doc.total > 0 && <> · %{Math.round(progress(doc) * 100)}</>}
        </div>
      </div>
    </div>
  );
}

/** "Tüm belgeler" kartı: kütüphaneye geçiş. */
export function AllDocsCard({ count, index }: { count: number; index: number }) {
  return (
    <Link className={styles.card} style={{ animationDelay: `${index * 60}ms` }} href="/ceviri-app/kutuphane">
      <div className={styles.more}>
        <div className={styles.mini}>
          <span />
          <span />
          <span />
        </div>
        Tüm belgeler
        <small>{count} belge</small>
      </div>
    </Link>
  );
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

/** Belgenin çevirisini sayfadan ayrılmadan indirir; hata olursa mesajını döndürür. */
export async function downloadTranslation(doc: { id: string; filename: string }): Promise<string | null> {
  const res = await fetch(`/api/ceviri/documents/${doc.id}/download`);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    return payload.error ?? "İndirme başarısız.";
  }
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filenameFrom(res.headers.get("content-disposition"), doc.filename);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  return null;
}

/** Hızlı bakış: büyük önizleme ve belgenin künyesi; açmadan indirmek de buradan. */
export function QuickView({
  doc,
  onClose,
  onOpen,
}: {
  doc: LibraryItem;
  onClose: () => void;
  onOpen: (doc: LibraryItem) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = doc.total > 0 && doc.translated === doc.total;
  const badge = BADGES[doc.kind];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function download() {
    setDownloading(true);
    setError(null);
    setError(await downloadTranslation(doc));
    setDownloading(false);
  }

  return (
    <div className={`${styles.tokens} ${styles.overlay}`} onClick={onClose} role="dialog" aria-modal="true" aria-label={doc.filename}>
      <div className={styles.peek} onClick={(event) => event.stopPropagation()}>
        <PagePreview doc={doc} width={720} className={styles.peekPage} />
        <div className={styles.peekSide}>
          <span className={`${styles.badge} ${styles.peekBadge} ${badge.cls}`}>
            {badge.label}
            {doc.pages ? ` · ${doc.pages} sayfa` : ""}
          </span>
          <h3>{doc.filename}</h3>
          <div className={styles.kv}>
            <span>Diller</span>
            <b>
              <Flag code={doc.source_lang} />
              {languageLabel(doc.source_lang)} → <Flag code={doc.target_lang} />
              {languageLabel(doc.target_lang)}
            </b>
          </div>
          <div className={styles.kv}>
            <span>Durum</span>
            <b style={{ color: done ? "#16794a" : undefined }}>
              {done ? "Tamamı çevrildi" : doc.translated ? "Yarım kaldı" : "Başlanmadı"} · {doc.translated}/{doc.total}
            </b>
          </div>
          <div className={styles.kv}>
            <span>Yüklendi</span>
            <b>
              {new Date(doc.created_at).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}
            </b>
          </div>
          <div className={styles.peekActions}>
            <button className={styles.primary} type="button" onClick={() => onOpen(doc)}>
              Belgeyi aç
            </button>
            {done && (
              <button className={styles.secondary} type="button" onClick={() => void download()} disabled={downloading}>
                {downloading ? "Hazırlanıyor…" : "Çeviriyi indir"}
              </button>
            )}
            {error && <div className={styles.peekError}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
