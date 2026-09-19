"use client";

import { useState } from "react";
import styles from "./ceviri.module.css";

type TmMatch = {
  id: string;
  source_text: string;
  target_text: string;
  score: number;
  origin: string;
  quality: string;
  project_names: string[];
};

type TermHit = {
  conceptId: string;
  scopeType: string;
  sourceText: string;
  targetText: string;
  isForbidden: boolean;
  notes: string | null;
};

type Result = { matches: TmMatch[]; terms: { preferred: TermHit[]; forbidden: TermHit[] } };

const LANGS = ["en-US", "tr-TR", "de-DE", "ru-RU", "es-ES", "it-IT", "el-GR", "pl-PL"];

const EXAMPLES = [
  "Trade name of the plant protection product",
  "Certificate of composition",
  "Analysis method",
  "Storage stability test",
];

/** Groups matches by source sentence so competing translations sit together. */
function groupBySource(matches: TmMatch[]) {
  const groups = new Map<string, TmMatch[]>();
  for (const match of matches) {
    const list = groups.get(match.source_text);
    if (list) list.push(match);
    else groups.set(match.source_text, [match]);
  }
  return [...groups.values()];
}

function scoreClass(score: number) {
  if (score >= 0.95) return styles.exact;
  if (score >= 0.75) return styles.fuzzy;
  return styles.weak;
}

export default function SearchClient() {
  const [sourceText, setSourceText] = useState(EXAMPLES[0]);
  const [sourceLang, setSourceLang] = useState("en-US");
  const [targetLang, setTargetLang] = useState("tr-TR");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(text: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ceviri/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceText: text, sourceLang, targetLang }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Arama basarisiz.");
      setResult(payload as Result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Arama basarisiz.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const groups = result ? groupBySource(result.matches) : [];
  const termCount = result ? result.terms.preferred.length + result.terms.forbidden.length : 0;

  return (
    <>
      <form
        className={styles.panel}
        onSubmit={(event) => {
          event.preventDefault();
          void run(sourceText);
        }}
      >
        <label className={styles.field}>
          <textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="Bellekte aranacak cümle veya terim"
            rows={3}
            required
          />
        </label>

        <div className={styles.controls}>
          <select
            className={styles.select}
            value={sourceLang}
            onChange={(event) => setSourceLang(event.target.value)}
            aria-label="Kaynak dil"
          >
            {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
          </select>
          <span className={styles.arrow}>→</span>
          <select
            className={styles.select}
            value={targetLang}
            onChange={(event) => setTargetLang(event.target.value)}
            aria-label="Hedef dil"
          >
            {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
          </select>
          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? "Aranıyor…" : "Bellekte ara"}
          </button>
        </div>

        <p className={styles.hint}>
          Deneyin:
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setSourceText(example);
                void run(example);
              }}
            >
              {example}
            </button>
          ))}
        </p>
      </form>

      {error && <p className={styles.alert} role="alert">{error}</p>}

      {result && (
        <div className={styles.results}>
          <section>
            <div className={styles.sectionHead}>
              <h2>Terminoloji</h2>
              <span className={styles.count}>{termCount} eşleşme</span>
            </div>
            {termCount === 0 ? (
              <div className={styles.empty}>Bu metinde tanımlı terim geçmiyor.</div>
            ) : (
              <div className={styles.termList}>
                {result.terms.forbidden.map((hit) => (
                  <span key={"f-" + hit.conceptId} className={styles.term + " " + styles.forbidden}>
                    <span className={styles.forbiddenTag}>YASAKLI</span>
                    <span className={styles.termSource}>{hit.sourceText}</span>
                    <span className={styles.arrow}>→</span>
                    <span className={styles.termTarget}>{hit.targetText}</span>
                  </span>
                ))}
                {result.terms.preferred.map((hit) => (
                  <span key={hit.conceptId} className={styles.term}>
                    <span className={styles.termSource}>{hit.sourceText}</span>
                    <span className={styles.arrow}>→</span>
                    <span className={styles.termTarget}>{hit.targetText}</span>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className={styles.sectionHead}>
              <h2>Çeviri belleği</h2>
              <span className={styles.count}>{result.matches.length} eşleşme</span>
            </div>

            {result.matches.length === 0 ? (
              <div className={styles.empty}>Bu cümleye yakın bir kayıt bulunamadı.</div>
            ) : (
              <div className={styles.results}>
                {groups.map((group) => {
                  const targets = new Set(group.map((match) => match.target_text));
                  const conflicted = targets.size > 1;
                  const sorted = [...group].sort(
                    (a, b) => b.project_names.length - a.project_names.length,
                  );
                  return (
                    <article key={group[0].source_text} className={styles.group}>
                      <header className={styles.groupHead}>
                        <div className={styles.groupSource}>{group[0].source_text}</div>
                        {conflicted && (
                          <div className={styles.conflict}>
                            Tutarsızlık: bu cümle {targets.size} farklı şekilde çevrilmiş
                          </div>
                        )}
                      </header>
                      {sorted.map((match, index) => (
                        <div key={match.id} className={styles.variant}>
                          <span className={styles.score + " " + scoreClass(match.score)}>
                            %{Math.round(match.score * 100)}
                          </span>
                          <div className={styles.variantBody}>
                            <div className={styles.target}>
                              {match.target_text}
                              {conflicted && index === 0 && (
                                <span className={styles.dominant}>EN ÇOK KULLANILAN</span>
                              )}
                            </div>
                            <div className={styles.projects}>
                              <span className={styles.usage}>
                                {match.project_names.length} projede
                              </span>
                              {match.project_names.slice(0, 4).map((name) => (
                                <span key={name} className={styles.project}>{name}</span>
                              ))}
                              {match.project_names.length > 4 && (
                                <span className={styles.more}>
                                  +{match.project_names.length - 4}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
