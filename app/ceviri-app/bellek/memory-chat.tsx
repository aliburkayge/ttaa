"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "../lingua.module.css";

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

export type Stats = {
  segments: number;
  multiProject: number;
  concepts: number;
  variants: number;
  languages: number;
};

/** Bir arama turu: sorulan cümle ve dönen cevap. */
type Turn = {
  query: string;
  sourceLang: string;
  targetLang: string;
  result: Result | null;
  error: string | null;
};

const LANGS = ["en-US", "tr-TR", "de-DE", "ru-RU", "es-ES", "it-IT", "el-GR", "pl-PL"];

const EXAMPLES = [
  "Trade name of the plant protection product",
  "Certificate of composition",
  "Analysis method",
  "Storage stability test",
];

/** Aynı kaynak cümlenin rakip çevirileri yan yana dursun diye gruplanır. */
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

function tr(value: number) {
  return value.toLocaleString("tr-TR");
}

export default function MemoryChat({ stats }: { stats: Stats | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sourceLang, setSourceLang] = useState("en-US");
  const [targetLang, setTargetLang] = useState("tr-TR");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy]);

  async function search(text: string) {
    const query = text.trim();
    if (!query || busy) return;
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    try {
      const response = await fetch("/api/ceviri/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceText: query, sourceLang, targetLang }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Arama başarısız.");
      setTurns((previous) => [
        ...previous,
        { query, sourceLang, targetLang, result: payload as Result, error: null },
      ]);
    } catch (cause) {
      setTurns((previous) => [
        ...previous,
        {
          query,
          sourceLang,
          targetLang,
          result: null,
          error: cause instanceof Error ? cause.message : "Arama başarısız.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function grow(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }

  return (
    <div className={styles.app} lang="tr">
      <div className={styles.top}>
        <Link className={styles.mark} href="/ceviri-app">
          <span className={styles.markDot} />
          Lingua
        </Link>
        <span className={styles.topSpacer} />
        <Link className={styles.topLink} href="/ceviri-app">Belge çevir</Link>
        <Link className={styles.topLink} href="/">Panel</Link>
      </div>

      <div className={styles.stream} ref={streamRef}>
        <div className={styles.streamInner}>
          {turns.length === 0 && (
            <div className={styles.hello}>
              <div className={styles.orb} />
              <p className={styles.helloTitle}>Belleğinizde ne var, bakalım</p>
              <p className={styles.helloText}>
                Bir cümle veya terim yazın; aynısını ya da benzerini geçmiş çevirilerinizde arar,
                hangi projelerde nasıl çevrildiğini ve aralarında tutarsızlık olup olmadığını
                gösteririm.
              </p>
              {stats && (
                <div className={styles.statStrip}>
                  <span className={styles.statPill}><b>{tr(stats.segments)}</b> segment</span>
                  <span className={styles.statPill}><b>{tr(stats.multiProject)}</b> çok projeli</span>
                  <span className={styles.statPill}><b>{tr(stats.concepts)}</b> terim</span>
                  <span className={styles.statPill}>
                    <b>{tr(stats.variants)}</b> karşılık · {stats.languages} dil
                  </span>
                </div>
              )}
              <div className={styles.chips}>
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    className={styles.chip}
                    type="button"
                    onClick={() => void search(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, index) => {
            const groups = turn.result ? groupBySource(turn.result.matches) : [];
            const terms = turn.result?.terms;
            const termCount = terms ? terms.preferred.length + terms.forbidden.length : 0;

            return (
              <div key={`${turn.query}-${index}`}>
                <div className={`${styles.turn} ${styles.turnUser}`}>
                  <div className={styles.bubbleUser}>
                    {turn.query}
                    <div className={styles.fileMeta}>
                      {turn.sourceLang} → {turn.targetLang}
                    </div>
                  </div>
                </div>

                <div className={`${styles.turn} ${styles.turnBot}`}>
                  <span className={styles.avatar} />
                  <div className={styles.botBody}>
                    {turn.error ? (
                      <div className={styles.err}>{turn.error}</div>
                    ) : (
                      <>
                        <p className={styles.botText}>
                          Bellekte <b>{turn.result?.matches.length ?? 0}</b> eşleşme
                          {termCount > 0 && <> ve <b>{termCount}</b> tanımlı terim</>} buldum.
                        </p>

                        <div className={styles.sectionHead}>
                          TERMİNOLOJİ
                          <span className={styles.sectionCount}>{termCount} eşleşme</span>
                        </div>
                        {termCount === 0 ? (
                          <div className={styles.empty}>Bu metinde tanımlı terim geçmiyor.</div>
                        ) : (
                          <div className={styles.termList}>
                            {terms?.forbidden.map((hit) => (
                              <span
                                key={`f-${hit.conceptId}`}
                                className={`${styles.term} ${styles.termForbidden}`}
                              >
                                <span className={styles.forbiddenTag}>YASAKLI</span>
                                <span>{hit.sourceText}</span>
                                <span className={styles.termArrow}>→</span>
                                <span className={styles.termTarget}>{hit.targetText}</span>
                              </span>
                            ))}
                            {terms?.preferred.map((hit) => (
                              <span key={hit.conceptId} className={styles.term}>
                                <span>{hit.sourceText}</span>
                                <span className={styles.termArrow}>→</span>
                                <span className={styles.termTarget}>{hit.targetText}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        <div className={styles.sectionHead}>
                          ÇEVİRİ BELLEĞİ
                          <span className={styles.sectionCount}>
                            {turn.result?.matches.length ?? 0} eşleşme
                          </span>
                        </div>
                        {groups.length === 0 ? (
                          <div className={styles.empty}>Bu cümleye yakın bir kayıt bulunamadı.</div>
                        ) : (
                          groups.map((group) => {
                            const targets = new Set(group.map((match) => match.target_text));
                            const conflicted = targets.size > 1;
                            const sorted = [...group].sort(
                              (a, b) => b.project_names.length - a.project_names.length,
                            );
                            return (
                              <div
                                key={group[0].source_text}
                                className={`${styles.card} ${styles.group}`}
                              >
                                <div className={styles.groupHead}>
                                  <div className={styles.groupSource}>{group[0].source_text}</div>
                                  {conflicted && (
                                    <div className={styles.conflict}>
                                      Tutarsızlık: bu cümle {targets.size} farklı şekilde çevrilmiş
                                    </div>
                                  )}
                                </div>
                                {sorted.map((match, position) => (
                                  <div key={match.id} className={styles.variant}>
                                    <span className={`${styles.score} ${scoreClass(match.score)}`}>
                                      %{Math.round(match.score * 100)}
                                    </span>
                                    <div className={styles.variantBody}>
                                      <div className={styles.target}>
                                        {match.target_text}
                                        {conflicted && position === 0 && (
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
                              </div>
                            );
                          })
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {busy && (
            <div className={`${styles.turn} ${styles.turnBot}`}>
              <span className={styles.avatar} />
              <div className={styles.botBody}>
                <p className={styles.typing}>Bellekte aranıyor…</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.dock}>
        <div className={styles.dockInner}>
          <div className={styles.composer}>
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={1}
              value={draft}
              placeholder="Bellekte aranacak cümle veya terim…"
              onChange={(event) => { setDraft(event.target.value); grow(event.target); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void search(draft);
                }
              }}
            />
            <div className={styles.composerBar}>
              <select
                className={styles.langPick}
                value={sourceLang}
                onChange={(event) => setSourceLang(event.target.value)}
                aria-label="Kaynak dil"
              >
                {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
              </select>
              <span className={styles.model}>→</span>
              <select
                className={styles.langPick}
                value={targetLang}
                onChange={(event) => setTargetLang(event.target.value)}
                aria-label="Hedef dil"
              >
                {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
              </select>
              <span className={styles.model}>Birebir ve bulanık eşleşme</span>
              <button
                className={styles.send}
                type="button"
                title="Bellekte ara"
                onClick={() => void search(draft)}
                disabled={busy || draft.trim() === ""}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
