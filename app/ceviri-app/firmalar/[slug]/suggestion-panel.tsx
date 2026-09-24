"use client";

import { useCallback, useState } from "react";
import styles from "../../lingua.module.css";
import firms from "../../firms.module.css";
import { LANGS, readJson, useLoad, type FirmClient } from "./shared";

type Suggestion = {
  id: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  kind: "extracted" | "edit" | "conflict";
  score: number;
  evidence: Array<{ source: string; target: string; from?: string }>;
};

const KIND: Record<Suggestion["kind"], string> = { conflict: "FİRMA FARKI", extracted: "ÇIKARILDI", edit: "DÜZELTMEDEN" };

/** Firmanın terim önerileri: bellekten çıkarılanlar ve düzeltmelerden öğrenilenler (spec 5.5, 5.6). */
export default function SuggestionPanel({ client, onChange }: { client: FirmClient; onChange: () => void }) {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [langs, setLangs] = useState({ source: "en-US", target: "tr-TR" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await readJson(await fetch(`/api/ceviri/clients/${client.id}/suggestions`), "Öneriler okunamadı.");
      setList(payload.suggestions as Suggestion[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Öneriler okunamadı.");
    }
  }, [client.id]);
  useLoad(load);

  async function mine() {
    setBusy(true);
    setError(null);
    setMessage("Firmanın belleği taranıyor…");
    try {
      const payload = await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceLang: langs.source, targetLang: langs.target }),
        }),
        "Terim çıkarılamadı.",
      );
      setMessage(`${payload.mined} yeni öneri; ${payload.conflicts} tanesi genel terimceden farklı.`);
      await load();
      onChange();
    } catch (cause) {
      setMessage(null);
      setError(cause instanceof Error ? cause.message : "Terim çıkarılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(item: Suggestion, action: "accept" | "reject") {
    setError(null);
    try {
      await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/suggestions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, action, targetText: edits[item.id] ?? item.target_text }),
        }),
        "Öneri kaydedilemedi.",
      );
      setList((current) => current?.filter((suggestion) => suggestion.id !== item.id) ?? null);
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Öneri kaydedilemedi.");
    }
  }

  return (
    <>
      <div className={firms.panel}>
        <p className={firms.panelTitle}>Terim çıkar</p>
        <p className={firms.muted}>
          {client.name} belleğinde sık geçen ama genel bellekte nadir olan ifadeler ve firmanın bunları nasıl çevirdiği bulunur.
          Genel terimceden farklı çevrilenler &quot;firma farkı&quot; olarak işaretlenir. Kabul ettiğiniz terim firmanın terimcesine girer.
        </p>
        <div className={firms.row} style={{ borderTop: 0 }}>
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
          <button className={styles.primary} type="button" disabled={busy} onClick={() => void mine()}>
            Terim çıkar
          </button>
          {message && <span className={firms.ok}>{message}</span>}
        </div>
      </div>
      {error && <div className={styles.err}>{error}</div>}
      <div className={firms.panel}>
        {list === null && <span className={firms.muted}>yükleniyor…</span>}
        {list?.length === 0 && <span className={firms.muted}>Bekleyen öneri yok.</span>}
        {list?.map((item) => (
          <div className={firms.row} key={item.id}>
            <span className={`${firms.badge} ${item.kind === "conflict" ? firms.badgeRed : firms.badgeGreen}`}>{KIND[item.kind]}</span>
            <b>{item.source_text}</b>
            <span>→</span>
            <input
              className={firms.input}
              value={edits[item.id] ?? item.target_text}
              onChange={(e) => setEdits({ ...edits, [item.id]: e.target.value })}
            />
            <span className={`${firms.muted} ${firms.grow}`} title={item.evidence.map((each) => `${each.source} → ${each.target}`).join("\n")}>
              {item.evidence[0] ? `ör. “${item.evidence[0].target}”` : ""}
              {item.kind === "edit" ? ` · ${item.evidence.length} düzeltme` : ""}
              {item.kind === "conflict" && item.evidence[0]?.from ? ` · genel terimcede “${item.evidence[0].from}”` : ""}
            </span>
            <button className={styles.primary} type="button" onClick={() => void decide(item, "accept")}>
              Terimceye ekle
            </button>
            <button className={styles.secondary} type="button" onClick={() => void decide(item, "reject")}>
              Reddet
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
