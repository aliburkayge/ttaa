"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dateGroup, PAGE_SIZE, whenLabel, type FileKind, type LibraryItem } from "../../../lib/ceviri/library";
import { DocCard, LangPair, QuickView, thumbnailUrl } from "../doc-card";
import styles from "../library.module.css";

type Stats = { total: number; today: number; week: number };

const FILTERS: Array<{ kind: FileKind | "all"; label: string }> = [
  { kind: "all", label: "Tümü" },
  { kind: "pdf", label: "PDF" },
  { kind: "word", label: "Word" },
  { kind: "image", label: "Görsel" },
];

function ListRow({ doc, index, now, onOpen }: { doc: LibraryItem; index: number; now: Date; onOpen: () => void }) {
  const share = doc.total ? doc.translated / doc.total : 0;
  return (
    <div
      className={styles.listRow}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => event.key === "Enter" && onOpen()}
    >
      <div className={styles.listThumb}>
        {doc.kind !== "word" && (
          // eslint-disable-next-line @next/next/no-img-element -- önizleme oturumlu API'den gelir
          <img src={thumbnailUrl(doc.id, 240)} alt="" loading="lazy" />
        )}
      </div>
      <div className={styles.listName} title={doc.filename}>
        {doc.filename}
      </div>
      <div className={styles.listMeta}>
        <LangPair doc={doc} />
        <div className={styles.listProgress} title={`${doc.translated}/${doc.total}`}>
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
        {whenLabel(doc.created_at, now)}
      </div>
    </div>
  );
}

/**
 * Bütün belgeler: dosya adında arama, türe göre süzme, yüklenme gününe göre
 * gruplar. Aşağı kaydırdıkça 30'ar belge daha gelir.
 */
export default function Library() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState<LibraryItem | null>(null);
  const [now] = useState(() => new Date());
  const input = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef(0);

  // Yazarken her harfte değil, durunca aranır.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (offset: number) => {
      const ticket = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
        if (search) params.set("q", search);
        if (kind !== "all") params.set("kind", kind);
        if (offset === 0 && !stats) params.set("stats", "1");
        const res = await fetch(`/api/ceviri/documents?${params}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Belgeler okunamadı.");
        if (ticket !== request.current) return;
        setItems((current) => (offset === 0 ? payload.documents : [...current, ...payload.documents]));
        setCount(payload.count);
        if (payload.stats) setStats(payload.stats);
      } catch (cause) {
        if (ticket === request.current) setError(cause instanceof Error ? cause.message : "Belgeler okunamadı.");
      } finally {
        if (ticket === request.current) setLoading(false);
      }
    },
    [search, kind, stats],
  );

  // Arama ya da süzgeç değişince baştan.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load(0);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca arama ve süzgeçte yeniden başlar
  }, [search, kind]);

  // Sona yaklaşınca sonraki 30.
  const more = count !== null && items.length < count;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !more || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(items.length);
      },
      { rootMargin: "400px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, loading, items.length, load]);

  // "/" arar, Esc aramayı temizler.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === input.current) setQuery("");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(() => {
    const byGroup = new Map<string, LibraryItem[]>();
    for (const item of items) {
      const group = dateGroup(item.created_at, now);
      byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
    }
    return [...byGroup.entries()];
  }, [items, now]);

  const open = useCallback((doc: LibraryItem) => router.push(`/ceviri-app?belge=${doc.id}`), [router]);
  const closePeek = useCallback(() => setPeek(null), []);
  const firstLoad = loading && items.length === 0;
  let order = 0;

  return (
    <div className={`${styles.tokens} ${styles.library}`} lang="tr">
      <div className={styles.top}>
        <Link className={styles.mark} href="/ceviri-app">
          <span className={styles.markDot} />
          Lingua
        </Link>
        <span className={styles.spacer} />
        <Link className={`${styles.nav} ${styles.navOn}`} href="/ceviri-app/kutuphane" aria-current="page">
          Kütüphane
        </Link>
        <Link className={styles.nav} href="/ceviri-app/bellek">
          Bellek
        </Link>
        <Link className={styles.nav} href="/">
          Panel
        </Link>
      </div>

      <div className={styles.body}>
        <div className={styles.head}>
          <h1>Kütüphane</h1>
          {stats && <span className={styles.count}>{stats.total} belge</span>}
          {stats && (
            <div className={styles.stats}>
              <div className={styles.stat}>
                <small>Bugün</small>
                <b>{stats.today}</b>
              </div>
              <div className={styles.stat}>
                <small>Son 7 gün</small>
                <b>{stats.week}</b>
              </div>
              <div className={styles.stat}>
                <small>Toplam</small>
                <b>{stats.total}</b>
              </div>
            </div>
          )}
        </div>

        <div className={styles.bar}>
          <label className={styles.search}>
            <span className={styles.searchIcon}>⌕</span>
            <input
              ref={input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Dosya adında ara — ör. BASF, vekaletname, diploma"
              aria-label="Dosya adında ara"
            />
            {query ? (
              <button className={styles.clear} type="button" onClick={() => setQuery("")} aria-label="Aramayı temizle">
                ✕
              </button>
            ) : (
              <span className={styles.kbd}>/</span>
            )}
          </label>
          <div className={styles.filters}>
            {FILTERS.map((filter) => (
              <button
                key={filter.kind}
                type="button"
                className={filter.kind === kind ? `${styles.filter} ${styles.filterOn}` : styles.filter}
                onClick={() => setKind(filter.kind)}
              >
                {filter.label}
              </button>
            ))}
            <div className={styles.view}>
              <button type="button" className={view === "grid" ? styles.viewOn : undefined} onClick={() => setView("grid")}>
                Izgara
              </button>
              <button type="button" className={view === "list" ? styles.viewOn : undefined} onClick={() => setView("list")}>
                Liste
              </button>
            </div>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {!firstLoad && !error && items.length === 0 && (
          <div className={styles.empty}>
            <div>∅</div>
            {search ? `“${search}” için belge bulunamadı` : "Henüz belge yok — ana sayfadan bir belge yükleyin."}
          </div>
        )}

        {groups.map(([group, docs]) => (
          <div className={styles.group} key={group}>
            <div className={styles.groupTitle}>{group.toLocaleUpperCase("tr")}</div>
            {view === "grid" ? (
              <div className={styles.grid}>
                {docs.map((doc) => (
                  <DocCard key={doc.id} doc={doc} index={order++} now={now} onOpen={open} onPeek={setPeek} />
                ))}
              </div>
            ) : (
              <div className={styles.list}>
                {docs.map((doc) => (
                  <ListRow key={doc.id} doc={doc} index={order++} now={now} onOpen={() => open(doc)} />
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className={`${styles.group} ${styles.skeleton}`}>
            <div className={styles.grid}>
              {Array.from({ length: firstLoad ? 10 : 5 }, (_, index) => (
                <div className={styles.card} key={index}>
                  <div className={styles.thumb} />
                  <div className={styles.meta}>
                    <div className={styles.name} />
                    <div className={styles.sub} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={sentinel} className={styles.foot}>
          {!loading && count !== null && items.length > 0 && (more ? "Aşağı kaydırdıkça 30'ar belge daha yüklenir" : `${count} belgenin hepsi gösteriliyor`)}
        </div>
      </div>

      {peek && <QuickView doc={peek} onClose={closePeek} onOpen={open} />}
    </div>
  );
}
