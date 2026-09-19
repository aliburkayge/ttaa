import Link from "next/link";
import CompanySwitcher from "../company-switcher";
import { getCeviriSupabase } from "../../lib/ceviri/supabase";
import SearchClient from "./search-client";
import styles from "./ceviri.module.css";

export const metadata = { title: "Çeviri APP | TTAA" };
export const dynamic = "force-dynamic";

type Stats = {
  segments: number;
  multiProject: number;
  concepts: number;
  variants: number;
  languages: number;
};

async function loadStats(): Promise<Stats | null> {
  try {
    // Counted in one SQL call: array_length() has no PostgREST filter equivalent,
    // so the multi-project figure cannot be derived client side.
    const { data, error } = await getCeviriSupabase().rpc("ceviri_stats");
    if (error || !data?.[0]) return null;
    const row = data[0] as Record<string, number>;
    return {
      segments: Number(row.segments),
      multiProject: Number(row.multi_project),
      concepts: Number(row.concepts),
      variants: Number(row.variants),
      languages: Number(row.languages),
    };
  } catch {
    return null;
  }
}

function tr(value: number) {
  return value.toLocaleString("tr-TR");
}

export default async function TranslationAppPage() {
  const stats = await loadStats();

  return (
    <div className={styles.shell} lang="tr">
      <header className="studio-header">
        <CompanySwitcher current="translation" />
        <Link href="/" className={styles.back}>← Panele dön</Link>
      </header>

      <main className={styles.main}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>Çeviri APP · Bilgi tabanı</span>
          <h1>Daha önce nasıl çevirdiğinizi<br />bir saniyede görün</h1>
          <p>
            Geçmiş çevirileriniz ve terminolojiniz tek yerde. Bir cümle yazın; sistem belleğinizde
            aynısını veya benzerini arar, hangi projelerde nasıl çevrildiğini ve aralarında
            tutarsızlık olup olmadığını gösterir.
          </p>
        </div>

        {stats && (
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statValue}>{tr(stats.segments)}</div>
              <div className={styles.statLabel}>çeviri belleği segmenti</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{tr(stats.multiProject)}</div>
              <div className={styles.statLabel}>birden fazla projede geçen</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{tr(stats.concepts)}</div>
              <div className={styles.statLabel}>terim kavramı</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{tr(stats.variants)}</div>
              <div className={styles.statLabel}>{stats.languages} dilde karşılık</div>
            </div>
          </div>
        )}

        <SearchClient />
      </main>
    </div>
  );
}
