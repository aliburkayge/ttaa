import Link from "next/link";
import CompanySwitcher from "../../company-switcher";
import SearchClient from "../search-client";
import styles from "../ceviri.module.css";

export const metadata = { title: "Bellek Arama | Çeviri APP" };

export default function MemorySearchPage() {
  return (
    <div className={styles.shell} lang="tr">
      <header className="studio-header">
        <CompanySwitcher current="translation" />
        <Link href="/ceviri-app" className={styles.back}>← Çeviri APP</Link>
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>Bellek ve terminoloji</span>
          <h1>Daha önce nasıl çevirdiğinizi görün</h1>
          <p>
            Bir cümle yazın; sistem belleğinizde aynısını veya benzerini arar, hangi projelerde
            nasıl çevrildiğini ve aralarında tutarsızlık olup olmadığını gösterir.
          </p>
        </div>
        <SearchClient />
      </main>
    </div>
  );
}
