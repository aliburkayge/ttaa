"use client";

import "flag-icons/css/flag-icons.min.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { findLanguage, LANGUAGES, type Language } from "../../lib/ceviri/languages";
import styles from "./library.module.css";

/** Dilin bayrağı (flag-icons). Bilinmeyen kodda boş gri kutu. */
export function Flag({ code }: { code: string }) {
  const flag = findLanguage(code)?.flag;
  return <span className={`${flag ? `fi fi-${flag}` : ""} ${styles.flag}`} aria-hidden="true" />;
}

/** Düğmedeki kısa ad: İngilizcede "EN" ve bölge, diğerlerinde dilin kendi adı. */
function ShortName({ code }: { code: string }) {
  const lang = findLanguage(code);
  if (!lang) return <>{code}</>;
  if (lang.code.startsWith("en-")) {
    return (
      <>
        EN <small>{lang.code.slice(3)}</small>
      </>
    );
  }
  return <>{lang.native}</>;
}

function matches(lang: Language, query: string): boolean {
  const haystack = `${lang.native} ${lang.label} ${lang.code}`.toLocaleLowerCase("tr");
  return haystack.includes(query.toLocaleLowerCase("tr").trim());
}

/**
 * Bayraklı dil seçici. Menü yukarı açılır (sohbet kutusu sayfanın altında),
 * yazarak aranır, ok tuşları ve Enter ile seçilir, Esc ile kapanır.
 */
export default function LanguagePicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const list = useMemo(() => LANGUAGES.filter((lang) => matches(lang, query)), [query]);
  const groups = useMemo(() => [...new Set(list.map((lang) => lang.group))], [list]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    const focus = setTimeout(() => search.current?.focus(), 60);
    return () => {
      document.removeEventListener("mousedown", close);
      clearTimeout(focus);
    };
  }, [open]);

  function toggle() {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, LANGUAGES.findIndex((lang) => lang.code === value)));
    setOpen((current) => !current);
  }

  function choose(code: string) {
    onChange(code);
    setOpen(false);
  }

  function onKey(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (list.length ? (current + step + list.length) % list.length : 0));
    }
    if (event.key === "Enter" && list[active]) {
      event.preventDefault();
      choose(list[active].code);
    }
  }

  let order = 0;
  return (
    <div className={open ? `${styles.picker} ${styles.pickerOpen}` : styles.picker} ref={root} onKeyDown={onKey}>
      <button
        className={styles.pickerButton}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={`${label}: ${findLanguage(value)?.label ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={findLanguage(value)?.label ?? value}
      >
        <Flag code={value} />
        <ShortName code={value} />
        {!disabled && <span className={styles.chevron}>▼</span>}
      </button>
      <div className={styles.menu} role="listbox" aria-label={label}>
        <input
          ref={search}
          className={styles.menuSearch}
          placeholder="Dil ara…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          tabIndex={open ? 0 : -1}
        />
        {groups.map((group) => (
          <div key={group}>
            <div className={styles.menuGroup}>{group.toLocaleUpperCase("tr")}</div>
            {list
              .filter((lang) => lang.group === group)
              .map((lang) => {
                const index = list.indexOf(lang);
                const classes = [
                  styles.option,
                  lang.code === value ? styles.optionSelected : "",
                  index === active ? styles.optionActive : "",
                ].join(" ");
                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="option"
                    aria-selected={lang.code === value}
                    className={classes}
                    style={{ animationDelay: `${order++ * 22}ms` }}
                    onClick={() => choose(lang.code)}
                    onMouseEnter={() => setActive(index)}
                    tabIndex={open ? 0 : -1}
                  >
                    <Flag code={lang.code} />
                    {lang.code.startsWith("en-") ? `English · ${lang.label.split(" · ")[1]}` : lang.native}
                    <small>{lang.code}</small>
                  </button>
                );
              })}
          </div>
        ))}
        {!list.length && <div className={styles.menuGroup}>Sonuç yok</div>}
      </div>
    </div>
  );
}
