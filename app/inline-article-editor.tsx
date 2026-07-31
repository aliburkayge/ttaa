"use client";

import { useRef } from "react";
import type { JobBrand } from "../lib/jobs";
import type { GeneratedArticle } from "../lib/openai";

function AutoTextarea({ value, onChange, className, placeholder }: { value: string; onChange: (value: string) => void; className?: string; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <textarea
      ref={(node) => {
        ref.current = node;
        if (node) {
          node.style.height = "auto";
          node.style.height = `${node.scrollHeight}px`;
        }
      }}
      className={className}
      placeholder={placeholder}
      value={value}
      rows={1}
      onChange={(event) => {
        onChange(event.target.value);
        const node = event.target;
        node.style.height = "auto";
        node.style.height = `${node.scrollHeight}px`;
      }}
    />
  );
}

export default function InlineArticleEditor({ brand, article, onChange }: {
  brand: JobBrand;
  article: GeneratedArticle;
  onChange: (article: GeneratedArticle) => void;
}) {
  const isAy = brand === "ay-tercume";
  const p = (name: string) => (isAy ? `ayc-${name}` : `ttaa-${name}`);

  function patch(partial: Partial<GeneratedArticle>) {
    onChange({ ...article, ...partial });
  }

  function updateTldr(index: number, value: string) {
    const tldr = [...article.tldr];
    tldr[index] = value;
    patch({ tldr });
  }

  function updateSection(index: number, partial: Partial<GeneratedArticle["sections"][number]>) {
    const sections = [...article.sections];
    sections[index] = { ...sections[index], ...partial };
    patch({ sections });
  }

  function updateSectionItem(sectionIndex: number, itemIndex: number, value: string) {
    const section = article.sections[sectionIndex];
    const items = [...section.items];
    items[itemIndex] = value;
    updateSection(sectionIndex, { items });
  }

  function updateFaq(index: number, partial: Partial<GeneratedArticle["faqs"][number]>) {
    const faqs = [...article.faqs];
    faqs[index] = { ...faqs[index], ...partial };
    patch({ faqs });
  }

  return (
    <div className="live-editor-canvas">
      <article className={p("article")}>
        <header className={p("hero")}>
          <input className={p("eyebrow")} value={article.eyebrow} placeholder="Eyebrow" onChange={(event) => patch({ eyebrow: event.target.value })} />
          <input className={p("title")} value={article.title} placeholder="H1 başlık" onChange={(event) => patch({ title: event.target.value })} />
          <AutoTextarea className={p("lead")} value={article.intro} placeholder="Giriş paragrafı" onChange={(value) => patch({ intro: value })} />
        </header>

        <section className={p("tldr")}>
          <div className={p("tldr-mark")} aria-hidden="true">TL</div>
          <div>
            <span className={p("section-label")}>ÖZET</span>
            <h2>TL;DR</h2>
            <ul>
              {article.tldr.map((item, index) => (
                <li className="live-editor-item" key={index}>
                  <input value={item} onChange={(event) => updateTldr(index, event.target.value)} />
                  {article.tldr.length > 2 && <button type="button" className="live-editor-remove" onClick={() => patch({ tldr: article.tldr.filter((_, itemIndex) => itemIndex !== index) })}>×</button>}
                </li>
              ))}
            </ul>
            {article.tldr.length < 8 && <button type="button" className="live-editor-add" onClick={() => patch({ tldr: [...article.tldr, "Yeni madde"] })}>+ TL;DR maddesi ekle</button>}
          </div>
        </section>

        {article.sections.map((section, index) => (
          <section className={`${p("section")} live-editor-item`} key={index}>
            <div className={p("section-heading")}>
              <span className={p("section-line")} aria-hidden="true" />
              <div>
                <span className={p("section-label")}>BÖLÜM {String(index + 1).padStart(2, "0")}</span>
                <input value={section.title} placeholder="Bölüm başlığı (H2)" onChange={(event) => updateSection(index, { title: event.target.value })} />
              </div>
            </div>
            <div className={p("content-card")}>
              <AutoTextarea value={section.body} placeholder="Paragraf" onChange={(value) => updateSection(index, { body: value })} />
              {section.items.length > 0 && (
                <ul className={p("list")}>
                  {section.items.map((item, itemIndex) => (
                    <li className="live-editor-item" key={itemIndex}>
                      <span className={p("check")} aria-hidden="true">✓</span>
                      <input value={item} onChange={(event) => updateSectionItem(index, itemIndex, event.target.value)} />
                      <button type="button" className="live-editor-remove" onClick={() => updateSection(index, { items: section.items.filter((_, i) => i !== itemIndex) })}>×</button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="live-editor-add" onClick={() => updateSection(index, { items: [...section.items, "Yeni madde"] })}>+ Madde ekle</button>
            </div>
            {article.sections.length > 1 && <button type="button" className="live-editor-remove" style={{ display: "block", position: "static", marginTop: 10 }} onClick={() => patch({ sections: article.sections.filter((_, sectionIndex) => sectionIndex !== index) })}>Bölümü sil</button>}
          </section>
        ))}
        {article.sections.length < 14 && <button type="button" className="live-editor-add" onClick={() => patch({ sections: [...article.sections, { title: "Yeni bölüm", body: "", items: [] }] })}>+ Bölüm ekle</button>}

        <section className={p("section")}>
          <div className={p("section-heading")}>
            <span className={p("section-line")} aria-hidden="true" />
            <div><span className={p("section-label")}>SIKÇA SORULANLAR</span><h2>FAQ</h2></div>
          </div>
          <div className={p("faq-list")}>
            {article.faqs.map((faq, index) => (
              <article className={`${p("faq-item")} live-editor-item`} key={index}>
                <input value={faq.question} placeholder="Soru" onChange={(event) => updateFaq(index, { question: event.target.value })} style={{ fontWeight: 800 }} />
                <AutoTextarea value={faq.answer} placeholder="Cevap" onChange={(value) => updateFaq(index, { answer: value })} />
                <button type="button" className="live-editor-remove" style={{ display: "block", position: "static", marginTop: 8 }} onClick={() => patch({ faqs: article.faqs.filter((_, faqIndex) => faqIndex !== index) })}>Soruyu sil</button>
              </article>
            ))}
          </div>
          {article.faqs.length < 20 && <button type="button" className="live-editor-add" onClick={() => patch({ faqs: [...article.faqs, { question: "Yeni soru", answer: "" }] })}>+ Soru ekle</button>}
        </section>

        <section className={p("cta")}>
          <span className={p("section-label")}>SONRAKİ ADIM</span>
          <input value={article.cta.title} placeholder="CTA başlığı" onChange={(event) => patch({ cta: { ...article.cta, title: event.target.value } })} />
          <AutoTextarea value={article.cta.body} placeholder="CTA açıklaması" onChange={(value) => patch({ cta: { ...article.cta, body: value } })} />
          <input value={article.cta.buttonLabel} placeholder="Düğme metni" onChange={(event) => patch({ cta: { ...article.cta, buttonLabel: event.target.value } })} style={{ maxWidth: 260 }} />
        </section>
      </article>

      <div className="live-editor-seo-grid">
        <label>SEO title (45-65 karakter)<input value={article.seoTitle} onChange={(event) => patch({ seoTitle: event.target.value })} /></label>
        <label>Meta description (120-160 karakter)<textarea value={article.metaDescription} onChange={(event) => patch({ metaDescription: event.target.value })} /></label>
        <label>Slug<input value={article.slug} onChange={(event) => patch({ slug: event.target.value })} /></label>
        <label>Focus keyword<input value={article.focusKeyword} onChange={(event) => patch({ focusKeyword: event.target.value })} /></label>
        <label>Secondary keywords (virgülle ayır)<input value={article.secondaryKeywords.join(", ")} onChange={(event) => patch({ secondaryKeywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
      </div>
    </div>
  );
}
