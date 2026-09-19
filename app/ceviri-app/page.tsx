import Link from "next/link";
import CompanySwitcher from "../company-switcher";
import styles from "./construction.module.css";

export const metadata = { title: "Çeviri APP | TTAA" };

function Crane({ secondary = false }: { secondary?: boolean }) {
  return (
    <div className={`${styles.crane} ${secondary ? styles.secondary : ""}`}>
      <div className={styles.mast} />
      <div className={styles.jib}><i /><b /></div>
      <div className={styles.cabin} />
      <div className={styles.hoist}><div className={styles.cable} /><div className={styles.load}>A<span>文</span></div></div>
      <div className={styles.base} />
    </div>
  );
}

function Truck({ reverse = false }: { reverse?: boolean }) {
  return (
    <div className={`${styles.truckLane} ${reverse ? styles.reverse : ""}`}>
      <div className={styles.truck}>
        <div className={styles.truckBed}><i /><i /><i /></div>
        <div className={styles.truckCab}><i /></div>
        <div className={styles.chassis} />
        <i className={styles.wheel} /><i className={`${styles.wheel} ${styles.frontWheel}`} />
      </div>
    </div>
  );
}

export default function TranslationAppPage() {
  return (
    <div className={styles.shell} lang="tr">
      <header className="studio-header">
        <CompanySwitcher current="translation" />
        <Link href="/" className={styles.back}>← Panele dön</Link>
      </header>
      <main className={styles.main}>
        <div className={styles.copy}>
          <span className={styles.label}>Çeviri APP</span>
          <h1>Şu Anda Burası<br /><span>İnşa Ediliyor</span></h1>
          <p>Beklediğiniz için teşekkürler.<br />En yakın zamanda kullanıma açılacaktır.</p>
        </div>
        <div className={styles.scene} role="img" aria-label="TTAA renklerinde çalışan iki vinç ve hareket eden inşaat kamyonları">
          <div className={styles.skyline}><i /><i /><i /><i /><i /></div>
          <div className={styles.building}><i /><i /><i /><i /><i /><i /></div>
          <Crane /><Crane secondary />
          <div className={styles.materials}><i /><i /><i /></div>
          <div className={styles.barrier}><i /><i /></div>
          <div className={styles.road} />
          <Truck /><Truck reverse />
        </div>
        <div className={styles.status}><i /> Çalışmalar devam ediyor</div>
      </main>
    </div>
  );
}
