"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../lingua.module.css";
import firms from "../firms.module.css";

type Stats = { memory: number; terms: number; documents: number; suggestions: number };
type Firm = { id: string; name: string; slug: string; aliases: string[]; stats: Stats };
type PendingProject = {
  project_name: string;
  evidence: { sentences?: number; reason?: string; fingerprint?: string | null; confidence?: string | null; type?: string | null };
};

const number = (value: number) => value.toLocaleString("tr-TR");

/**
 * Firma listesi. Her firmanın kendi terimcesi, belleği ve referans
 * çevirileri vardır; eski arşivde firması kesinleşmemiş projeler burada
 * karara bağlanır.
 */
export default function Firms() {
  const [list, setList] = useState<Firm[] | null>(null);
  const [pending, setPending] = useState<PendingProject[]>([]);
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [clientsRes, projectsRes] = await Promise.all([fetch("/api/ceviri/clients"), fetch("/api/ceviri/projects")]);
      const clients = await clientsRes.json();
      const projects = await projectsRes.json();
      if (!clientsRes.ok) throw new Error(clients.error ?? "Firmalar okunamadı.");
      setList(clients.clients as Firm[]);
      if (projectsRes.ok) setPending(projects.projects as PendingProject[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firmalar okunamadı.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ceviri/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Firma oluşturulamadı.");
      setName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firma oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(projectName: string) {
    const value = choice[projectName] ?? "none";
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ceviri/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, clientId: value === "none" ? null : value }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Karar kaydedilemedi.");
      setMessage(`"${projectName}" kaydedildi.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Karar kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function rebuild() {
    setBusy(true);
    setError(null);
    setMessage("Parmak izi yeniden kuruluyor… (bir dakika sürebilir)");
    try {
      const res = await fetch("/api/ceviri/clients/signatures", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Parmak izi kurulamadı.");
      setMessage(`Parmak izi kuruldu: ${number(payload.signatures)} özgü ifade, ${number(payload.documents)} belge/proje tarandı.`);
    } catch (cause) {
      setMessage(null);
      setError(cause instanceof Error ? cause.message : "Parmak izi kurulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.app} lang="tr">
      <div className={styles.top}>
        <Link className={styles.mark} href="/ceviri-app">
          <span className={styles.markDot} />
          Lingua
        </Link>
        <span className={styles.topSpacer} />
        <Link className={styles.topLink} href="/ceviri-app">Çeviri</Link>
        <Link className={styles.topLink} href="/ceviri-app/kutuphane">Kütüphane</Link>
        <Link className={styles.topLink} href="/ceviri-app/bellek">Bellek</Link>
      </div>
      <div className={firms.page}>
        <div className={firms.inner}>
          <div className={firms.head}>
            <div style={{ flex: 1 }}>
              <h1 className={firms.title}>Firmalar</h1>
              <p className={firms.sub}>
                Her firmanın kendi terimcesi, belleği ve referans çevirileri. Belge yüklenirken firma seçilir ya da
                otomatik tanınır; çeviri önce o firmanın kütüphanesine bakar.
              </p>
            </div>
            <button className={styles.secondary} type="button" onClick={() => void rebuild()} disabled={busy}>
              Parmak izini yenile
            </button>
          </div>

          {error && <div className={styles.err}>{error}</div>}
          {message && <p className={firms.ok}>{message}</p>}

          <div className={firms.grid}>
            {list?.map((item) => (
              <Link key={item.id} className={firms.card} href={`/ceviri-app/firmalar/${item.slug}`}>
                <div className={firms.cardName}>{item.name}</div>
                <div className={firms.nums}>
                  <span><b>{number(item.stats.memory)}</b> cümle</span>
                  <span><b>{number(item.stats.terms)}</b> terim</span>
                  <span><b>{number(item.stats.documents)}</b> belge</span>
                  {item.stats.suggestions > 0 && (
                    <span className={`${firms.badge} ${firms.badgeGreen}`}>{item.stats.suggestions} öneri</span>
                  )}
                </div>
              </Link>
            ))}
            <div className={firms.card}>
              <div className={firms.cardName}>Yeni firma</div>
              <div className={firms.row} style={{ borderTop: 0, padding: 0 }}>
                <input
                  className={`${firms.input} ${firms.grow}`}
                  placeholder="Firma adı"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void create()}
                />
                <button className={styles.primary} type="button" onClick={() => void create()} disabled={busy || !name.trim()}>
                  Ekle
                </button>
              </div>
            </div>
          </div>

          {pending.length > 0 && (
            <div className={firms.section}>
              <div className={firms.sectionHead}>
                <h2 className={firms.sectionTitle}>Karar bekleyen projeler</h2>
                <span className={firms.muted}>
                  Eski bellekte iki firmanın izini taşıyan ya da izi çok zayıf projeler. Seçtiğiniz firmaya bağlanır.
                </span>
              </div>
              <div className={firms.panel}>
                {pending.map((project) => (
                  <div className={firms.row} key={project.project_name}>
                    <div className={firms.grow}>
                      <b>{project.project_name}</b>
                      <div className={firms.muted}>
                        {project.evidence.sentences ? `${number(project.evidence.sentences)} cümle · ` : ""}
                        {project.evidence.confidence || project.evidence.reason}
                        {project.evidence.type ? ` · ${project.evidence.type}` : ""}
                      </div>
                    </div>
                    <select
                      className={firms.select}
                      value={choice[project.project_name] ?? "none"}
                      onChange={(event) => setChoice({ ...choice, [project.project_name]: event.target.value })}
                    >
                      <option value="none">Genel</option>
                      {list?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <button className={styles.secondary} type="button" disabled={busy} onClick={() => void decide(project.project_name)}>
                      Kaydet
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
