"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import styles from "../../lingua.module.css";
import firms from "../../firms.module.css";
import ImportPanel from "./import-panel";
import { LANGS, number, readJson, useLoad, type FirmClient } from "./shared";
import SuggestionPanel from "./suggestion-panel";

type Stats = { memory: number; terms: number; documents: number; suggestions: number };
type Term = { id: string; variants: Array<{ lang: string; text: string; is_forbidden: boolean }> };
type Tab = "terimce" | "yukle" | "oneriler" | "belgeler" | "ayarlar";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "terimce", label: "Terimce" },
  { id: "yukle", label: "Kütüphaneye yükle" },
  { id: "oneriler", label: "Öneriler" },
  { id: "belgeler", label: "Belgeler" },
  { id: "ayarlar", label: "Ayarlar" },
];

function TermsTab({ client, onChange }: { client: FirmClient; onChange: () => void }) {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ sourceLang: "en-US", sourceText: "", targetLang: "tr-TR", targetText: "", forbidden: false });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await readJson(await fetch(`/api/ceviri/clients/${client.id}/terms?q=${encodeURIComponent(q)}`), "Terimler okunamadı.");
      setTerms(payload.terms as Term[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Terimler okunamadı.");
    }
  }, [client.id, q]);
  useLoad(load);

  async function add() {
    setError(null);
    try {
      await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/terms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }),
        "Terim eklenemedi.",
      );
      setForm({ ...form, sourceText: "", targetText: "", forbidden: false });
      await load();
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Terim eklenemedi.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Bu terim firmanın terimcesinden silinsin mi?")) return;
    try {
      await readJson(await fetch(`/api/ceviri/clients/${client.id}/terms?conceptId=${id}`, { method: "DELETE" }), "Terim silinemedi.");
      await load();
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Terim silinemedi.");
    }
  }

  return (
    <>
      <div className={firms.panel}>
        <p className={firms.panelTitle}>Terim ekle</p>
        <p className={firms.muted}>
          {client.name} belgelerinde bu terim her zaman bu karşılıkla çevrilir; genel terimcede başka bir karşılık varsa onun yerine geçer.
        </p>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <select className={firms.select} value={form.sourceLang} onChange={(e) => setForm({ ...form, sourceLang: e.target.value })}>
            {LANGS.map((lang) => (
              <option key={lang}>{lang}</option>
            ))}
          </select>
          <input
            className={`${firms.input} ${firms.grow}`}
            placeholder="Kaynak terim (ör. registration)"
            value={form.sourceText}
            onChange={(e) => setForm({ ...form, sourceText: e.target.value })}
          />
          <select className={firms.select} value={form.targetLang} onChange={(e) => setForm({ ...form, targetLang: e.target.value })}>
            {LANGS.map((lang) => (
              <option key={lang}>{lang}</option>
            ))}
          </select>
          <input
            className={`${firms.input} ${firms.grow}`}
            placeholder="Firmanın karşılığı (ör. ruhsat)"
            value={form.targetText}
            onChange={(e) => setForm({ ...form, targetText: e.target.value })}
          />
          <label className={firms.muted}>
            <input type="checkbox" checked={form.forbidden} onChange={(e) => setForm({ ...form, forbidden: e.target.checked })} /> yasaklı karşılık
          </label>
          <button className={styles.primary} type="button" onClick={() => void add()} disabled={!form.sourceText.trim() || !form.targetText.trim()}>
            Ekle
          </button>
        </div>
      </div>
      {error && <div className={styles.err}>{error}</div>}
      <div className={firms.panel}>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <input className={`${firms.input} ${firms.grow}`} placeholder="Terimcede ara" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className={firms.muted}>{terms ? `${terms.length} terim` : "yükleniyor…"}</span>
        </div>
        {terms?.map((term) => (
          <div className={firms.row} key={term.id}>
            <div className={firms.grow}>
              {term.variants.map((variant) => (
                <span key={`${variant.lang}-${variant.text}`} style={{ marginRight: 14 }}>
                  <span className={firms.muted}>{variant.lang}</span> <b>{variant.text}</b>
                  {variant.is_forbidden && (
                    <>
                      {" "}
                      <span className={`${firms.badge} ${firms.badgeRed}`}>YASAKLI</span>
                    </>
                  )}
                </span>
              ))}
            </div>
            <button className={styles.secondary} type="button" onClick={() => void remove(term.id)}>
              Sil
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function SettingsTab({ client, onSaved }: { client: FirmClient; onSaved: (client: FirmClient) => void }) {
  const [name, setName] = useState(client.name);
  const [aliases, setAliases] = useState(client.aliases.join(", "));
  const [instructions, setInstructions] = useState(client.instructions ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setMessage(null);
    try {
      const payload = await readJson(
        await fetch(`/api/ceviri/clients/${client.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, aliases, instructions }),
        }),
        "Kaydedilemedi.",
      );
      onSaved(payload.client as FirmClient);
      setMessage("Kaydedildi.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kaydedilemedi.");
    }
  }

  return (
    <div className={firms.panel}>
      <p className={firms.panelTitle}>Ad</p>
      <input className={firms.input} value={name} onChange={(e) => setName(e.target.value)} />
      <p className={firms.panelTitle} style={{ marginTop: 16 }}>
        Tüzel adlar ve takma adlar
      </p>
      <p className={firms.muted}>
        Belgede bunlardan biri geçerse firma tanınır. Virgülle ayırın (ör. Bayer CropScience, Bayer Türk Kimya).
      </p>
      <textarea className={firms.textarea} value={aliases} onChange={(e) => setAliases(e.target.value)} />
      <p className={firms.panelTitle} style={{ marginTop: 16 }}>
        Firma talimatları
      </p>
      <p className={firms.muted}>
        Bu firmanın her belgesinde uygulanır (ör. &quot;Adresler çevrilmez&quot;, &quot;Registration her zaman ruhsat&quot;).
      </p>
      <textarea className={firms.textarea} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      <div className={firms.row} style={{ borderTop: 0 }}>
        <button className={styles.primary} type="button" onClick={() => void save()}>
          Kaydet
        </button>
        {message && <span className={firms.ok}>{message}</span>}
        {error && <span className={styles.err}>{error}</span>}
      </div>
    </div>
  );
}

function DocumentsTab({ client }: { client: FirmClient }) {
  const [docs, setDocs] = useState<Array<{ id: string; filename: string; created_at: string }> | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/ceviri/documents?client=${client.id}&limit=60`);
    const payload = await res.json().catch(() => ({ documents: [] }));
    setDocs(res.ok ? payload.documents : []);
  }, [client.id]);
  useLoad(load);
  return (
    <div className={firms.panel}>
      {docs === null && <span className={firms.muted}>yükleniyor…</span>}
      {docs?.length === 0 && <span className={firms.muted}>Bu firmayla çevrilmiş belge yok.</span>}
      {docs?.map((doc) => (
        <div className={firms.row} key={doc.id}>
          <Link className={firms.grow} href={`/ceviri-app?belge=${doc.id}`}>
            {doc.filename}
          </Link>
          <span className={firms.muted}>{new Date(doc.created_at).toLocaleDateString("tr-TR")}</span>
        </div>
      ))}
    </div>
  );
}

/** Bir firmanın kütüphanesi: terimce, yükleme, öneriler, belgeler, ayarlar. */
export default function Firm({ slug }: { slug: string }) {
  const [client, setClient] = useState<FirmClient | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<Tab>("terimce");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await readJson(await fetch(`/api/ceviri/clients/${encodeURIComponent(slug)}`), "Firma okunamadı.");
      setClient(payload.client as FirmClient);
      setStats(payload.stats as Stats);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firma okunamadı.");
    }
  }, [slug]);
  useLoad(load);

  return (
    <div className={styles.app} lang="tr">
      <div className={styles.top}>
        <Link className={styles.mark} href="/ceviri-app">
          <span className={styles.markDot} />
          Lingua
        </Link>
        <span className={styles.topSpacer} />
        <Link className={styles.topLink} href="/ceviri-app/firmalar">Firmalar</Link>
        <Link className={styles.topLink} href="/ceviri-app">Çeviri</Link>
      </div>
      <div className={firms.page}>
        <div className={firms.inner}>
          {error && <div className={styles.err}>{error}</div>}
          {client && stats && (
            <>
              <div className={firms.head}>
                <div style={{ flex: 1 }}>
                  <h1 className={firms.title}>{client.name}</h1>
                  <div className={firms.nums} style={{ marginTop: 8 }}>
                    <span><b>{number(stats.memory)}</b> cümle bellekte</span>
                    <span><b>{number(stats.terms)}</b> terim</span>
                    <span><b>{number(stats.documents)}</b> belge</span>
                    <span><b>{number(stats.suggestions)}</b> bekleyen öneri</span>
                  </div>
                </div>
              </div>
              <div className={firms.tabs}>
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={tab === item.id ? `${firms.tab} ${firms.tabOn}` : firms.tab}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {tab === "terimce" && <TermsTab client={client} onChange={() => void load()} />}
              {tab === "yukle" && <ImportPanel client={client} onChange={() => void load()} />}
              {tab === "oneriler" && <SuggestionPanel client={client} onChange={() => void load()} />}
              {tab === "belgeler" && <DocumentsTab client={client} />}
              {tab === "ayarlar" && <SettingsTab client={client} onSaved={setClient} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
