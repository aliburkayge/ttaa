"use client";

import { useState } from "react";
import styles from "../../lingua.module.css";
import firms from "../../firms.module.css";
import { LANGS, readJson, type FirmClient } from "./shared";

type Staged = { source: string; target: string; sourcePath: string; targetPath: string };

const shortName = (path: string) => path.split("/").pop() ?? path;

/**
 * Firmanın kütüphanesine dosya yükleme: terimce (xlsx), çeviri belleği (TMX),
 * tek referans çifti ya da orijinal + çeviri arşivi (zip).
 */
export default function ImportPanel({ client, onChange }: { client: FirmClient; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pair, setPair] = useState<{ source: File | null; target: File | null }>({ source: null, target: null });
  const [langs, setLangs] = useState({ source: "en-US", target: "tr-TR" });
  const [progress, setProgress] = useState<string | null>(null);
  const [leftovers, setLeftovers] = useState<string[]>([]);

  const describe = (stats: Record<string, number>) =>
    `${stats.aligned} paragraf eşlendi, ${stats.verified} tanesi doğrulatıldı, ${stats.stored} çift belleğe yazıldı, ${stats.dropped} atıldı.`;

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(`${file.name} içe aktarılıyor…`);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const payload = await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/imports`, { method: "POST", body: form }),
        "İçe aktarılamadı.",
      );
      const stats = payload.stats as Record<string, number>;
      setResult(
        payload.kind === "tmx"
          ? `${file.name}: ${stats.units} birim okundu, ${stats.inserted} yeni cümle, ${stats.merged} mevcut cümleyle birleşti.`
          : `${file.name}: ${stats.concepts} terim eklendi.`,
      );
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "İçe aktarılamadı.");
    } finally {
      setBusy(null);
    }
  }

  async function sendPair() {
    if (!pair.source || !pair.target) return;
    setBusy("Hizalanıyor… (taranmış belgede bir dakika sürebilir)");
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("source", pair.source);
      form.append("target", pair.target);
      form.append("sourceLang", langs.source);
      form.append("targetLang", langs.target);
      const payload = await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/references`, { method: "POST", body: form }),
        "Referans işlenemedi.",
      );
      setResult(`${pair.source.name}: ${describe(payload.stats as Record<string, number>)}`);
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Referans işlenemedi.");
    } finally {
      setBusy(null);
    }
  }

  async function sendZip(file: File | undefined) {
    if (!file) return;
    setBusy("Zip açılıyor…");
    setError(null);
    setResult(null);
    setLeftovers([]);
    try {
      const form = new FormData();
      form.append("file", file);
      const staged = await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/references/zip`, { method: "POST", body: form }),
        "Zip işlenemedi.",
      );
      const pairs = staged.pairs as Staged[];
      let stored = 0;
      const failed: string[] = [];
      for (const [index, item] of pairs.entries()) {
        setProgress(`${index + 1}/${pairs.length}: ${shortName(item.source)}`);
        try {
          const payload = await readJson(
            await fetch(`/api/ceviri/clients/${client.id}/references`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...item,
                sourceName: item.source,
                sourceLang: langs.source,
                targetLang: langs.target,
                importId: staged.importId,
              }),
            }),
            "Çift işlenemedi.",
          );
          stored += (payload.stats as Record<string, number>).stored;
        } catch (cause) {
          failed.push(`${shortName(item.source)}: ${cause instanceof Error ? cause.message : "okunamadı"}`);
        }
      }
      const unmatched = staged.unmatched as string[];
      const unsupported = staged.unsupported as string[];
      setResult(
        `${pairs.length} çift işlendi, ${stored} cümle belleğe yazıldı` +
          (failed.length ? `, ${failed.length} çift okunamadı` : "") +
          `. Eşlenemeyen: ${unmatched.length} dosya` +
          (unsupported.length ? `, eski Word (.doc) ya da desteklenmeyen biçim: ${unsupported.length} dosya` : "") +
          ".",
      );
      setLeftovers([
        ...failed,
        ...unmatched.map((name) => `eşlenemedi: ${shortName(name)}`),
        ...unsupported.map((name) => `desteklenmiyor: ${shortName(name)}`),
      ]);
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Zip işlenemedi.");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const langPicker = (
    <>
      <select className={firms.select} value={langs.source} onChange={(e) => setLangs({ ...langs, source: e.target.value })}>
        {LANGS.map((lang) => (
          <option key={lang}>{lang}</option>
        ))}
      </select>
      <span>→</span>
      <select className={firms.select} value={langs.target} onChange={(e) => setLangs({ ...langs, target: e.target.value })}>
        {LANGS.map((lang) => (
          <option key={lang}>{lang}</option>
        ))}
      </select>
    </>
  );

  return (
    <>
      <div className={firms.panel}>
        <p className={firms.panelTitle}>Terimce ya da çeviri belleği</p>
        <p className={firms.muted}>
          Terimce Excel&apos;i (.xlsx — Forbidden, Domain, Subdomain, Definition, dil sütunları) ya da TMX. İçerik yalnızca{" "}
          {client.name} için geçerli olur.
        </p>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <input type="file" accept=".xlsx,.tmx" disabled={busy !== null} onChange={(event) => void importFile(event.target.files?.[0])} />
        </div>
      </div>

      <div className={firms.panel}>
        <p className={firms.panelTitle}>Referans çevirisi (orijinal + çevirisi)</p>
        <p className={firms.muted}>
          Eski bir belge ve bu firmaya yaptığınız çevirisi. Paragraflar sayı, kod ve uzunluklarına göre eşlenir; emin
          olunamayanlar yapay zekâya doğrulatılır; eşlenenler {client.name} belleğine girer.
        </p>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <label className={firms.muted}>
            Orijinal{" "}
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.docx"
              onChange={(e) => setPair({ ...pair, source: e.target.files?.[0] ?? null })}
            />
          </label>
          <label className={firms.muted}>
            Çevirisi (.docx){" "}
            <input type="file" accept=".docx" onChange={(e) => setPair({ ...pair, target: e.target.files?.[0] ?? null })} />
          </label>
          {langPicker}
          <button className={styles.primary} type="button" disabled={busy !== null || !pair.source || !pair.target} onClick={() => void sendPair()}>
            Hizala ve ekle
          </button>
        </div>
      </div>

      <div className={firms.panel}>
        <p className={firms.panelTitle}>Arşiv (zip)</p>
        <p className={firms.muted}>
          Orijinaller ve çevirileri aynı klasörde; çevirinin adında dil eki olsun (bordro.pdf ↔ bordro-en.docx). Adları tam
          tutmayanlar kelimelerinden eşlenir. Çiftler tek tek işlenir.
        </p>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <input type="file" accept=".zip" disabled={busy !== null} onChange={(e) => void sendZip(e.target.files?.[0])} />
          {langPicker}
        </div>
        {progress && <p className={firms.muted}>{progress}</p>}
      </div>

      {busy && <p className={firms.muted}>{busy}</p>}
      {result && <p className={firms.ok}>{result}</p>}
      {error && <div className={styles.err}>{error}</div>}
      {leftovers.length > 0 && (
        <div className={firms.panel}>
          <p className={firms.panelTitle}>Belleğe alınamayanlar</p>
          {leftovers.slice(0, 200).map((line) => (
            <div className={firms.muted} key={line}>
              {line}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
