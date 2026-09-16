"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type FormEvent } from "react";
import QrIcon from "../qr-icon";
import { createAyVerificationLabel, validatePrototypeDetails, type PrototypeDetails } from "../../lib/qr-prototype";

type Label = Awaited<ReturnType<typeof createAyVerificationLabel>>;
type Result = { details: PrototypeDetails; label: Label; pageUrl: string; file: File | null; hasFile: boolean };
type Found = { url: string; details: Pick<PrototypeDetails, "documentNumber" | "customer" | "documentDate" | "documentType">; hasFile: boolean };

function downloadFile(dataUrl: string, name: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name;
  link.click();
}

async function pngFromSvg(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PNG etiketi hazırlanamadı.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export default function AyVerificationStudio({ today }: { today: string }) {
  const blank: PrototypeDetails = { documentNumber: "", customer: "", documentType: "Tercüme belgesi", documentDate: today, driveLink: "" };
  const [form, setForm] = useState<PrototypeDetails>(blank);
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [landingBusy, setLandingBusy] = useState(false);
  const [landingUrl, setLandingUrl] = useState("");
  const [error, setError] = useState("");
  const [existingUrl, setExistingUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [lookupNumber, setLookupNumber] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [lookupFile, setLookupFile] = useState<File | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachConfirmed, setAttachConfirmed] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupNotice, setLookupNotice] = useState("");
  const [records, setRecords] = useState<Found[]>([]);
  const [listQuery, setListQuery] = useState("");
  const [listPage, setListPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [listReload, setListReload] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const lookupFileInput = useRef<HTMLInputElement>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const dirty = Boolean(result && (file !== result.file || Object.keys(blank).some((key) => form[key as keyof PrototypeDetails].trim() !== result.details[key as keyof PrototypeDetails])));
  const ready = Boolean(result && !dirty && !busy);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setListBusy(true); setListError("");
      try {
        const response = await fetch(`/api/qr-documents/ay-tercume?list=1&q=${encodeURIComponent(listQuery)}&page=${listPage}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { records?: Found[]; hasMore?: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error || "Belge listesi alınamadı.");
        setRecords(payload.records || []); setHasMore(Boolean(payload.hasMore));
      } catch (failure) { if (!controller.signal.aborted) setListError(failure instanceof Error ? failure.message : "Belge listesi alınamadı."); }
      finally { if (!controller.signal.aborted) setListBusy(false); }
    }, listQuery ? 300 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [listQuery, listPage, listReload]);

  async function selectRecord(entry: Found) {
    const details = { ...entry.details, driveLink: "" };
    const label = await createAyVerificationLabel(details, entry.url);
    setResult({ details, file: null, label, pageUrl: entry.url, hasFile: entry.hasFile });
    setForm(details); setFile(null); setFound(entry); setLookupNumber(details.documentNumber);
    setLookupFile(null); setAttachConfirmed(false); setLookupError(""); setLookupNotice("");
    if (fileInput.current) fileInput.current.value = "";
    if (lookupFileInput.current) lookupFileInput.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function change(key: keyof PrototypeDetails, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(""); setExistingUrl(""); setNotice("");
  }

  function reset() {
    setForm(blank); setFile(null); setConfirmed(false); setResult(null);
    setError(""); setExistingUrl(""); setNotice("");
    if (fileInput.current) fileInput.current.value = "";
    numberInput.current?.focus();
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setExistingUrl(""); setNotice("");
    try {
      const details = validatePrototypeDetails(form);
      if (file && (!/\.pdf$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024)) throw new Error("En fazla 8 MB boyutunda bir PDF seçin.");
      if (!confirmed) throw new Error("Belgenin doğrulandığını ve bilgilerin herkese açık gösterileceğini onaylayın.");
      const data = new FormData();
      for (const key of ["documentNumber", "customer", "documentType", "documentDate"] as const) data.set(key, details[key]);
      data.set("mode", "create");
      if (file) data.set("file", file);
      data.set("confirmed", "true");
      setBusy(true);
      const response = await fetch("/api/qr-documents/ay-tercume", { method: "POST", body: data });
      const payload = await response.json() as { error?: string; url?: string; warning?: string | null; hasFile?: boolean };
      if (!response.ok || !payload.url) {
        setExistingUrl(payload.url || "");
        throw new Error(payload.error || "WordPress doğrulama sayfası oluşturulamadı.");
      }
      const label = await createAyVerificationLabel(details, payload.url);
      setForm(details);
      setResult({ details, file, label, pageUrl: payload.url, hasFile: Boolean(payload.hasFile) });
      setLookupNumber(details.documentNumber);
      setFound({ details, url: payload.url, hasFile: Boolean(payload.hasFile) });
      setLookupError(""); setLookupNotice("");
      setNotice(payload.warning ? `Sayfa yayımlandı. ${payload.warning}` : file ? "PDF ve doğrulama sayfası yayımlandı; QR bu adrese açılır." : "Doğrulama sayfası yayımlandı. PDF’yi daha sonra aşağıdaki alandan ekleyebilirsiniz.");
      setListReload((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "İşlem tamamlanamadı.");
    } finally { setBusy(false); }
  }

  async function lookupDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lookupBusy || attachBusy) return;
    setLookupBusy(true); setLookupError(""); setLookupNotice(""); setFound(null); setLookupFile(null);
    if (lookupFileInput.current) lookupFileInput.current.value = "";
    try {
      const response = await fetch(`/api/qr-documents/ay-tercume?documentNumber=${encodeURIComponent(lookupNumber.trim())}`, { cache: "no-store" });
      const payload = await response.json() as Found & { error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || "Belge bulunamadı.");
      await selectRecord(payload);
    } catch (failure) { setLookupError(failure instanceof Error ? failure.message : "Belge bulunamadı."); }
    finally { setLookupBusy(false); }
  }

  async function attachDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!found || attachBusy) return;
    setLookupError(""); setLookupNotice("");
    if (!lookupFile || !/\.pdf$/i.test(lookupFile.name) || !lookupFile.size || lookupFile.size > 8 * 1024 * 1024) { setLookupError("En fazla 8 MB boyutunda bir PDF seçin."); return; }
    if (!attachConfirmed) { setLookupError("PDF’nin herkese açık yayımlanacağını onaylayın."); return; }
    const data = new FormData();
    data.set("mode", found.hasFile ? "replace" : "attach"); data.set("documentNumber", found.details.documentNumber); data.set("file", lookupFile); data.set("confirmed", "true");
    setAttachBusy(true);
    try {
      const response = await fetch("/api/qr-documents/ay-tercume", { method: "POST", body: data });
      const payload = await response.json() as { error?: string; url?: string; warning?: string | null };
      if (!response.ok || !payload.url) throw new Error(payload.error || "PDF mevcut sayfaya eklenemedi.");
      setFound({ ...found, hasFile: true });
      setResult((current) => current && current.pageUrl === payload.url ? { ...current, hasFile: true } : current);
      if (result?.pageUrl === payload.url) setNotice("PDF aynı doğrulama sayfasına eklendi; QR adresi değişmedi.");
      setLookupFile(null); setAttachConfirmed(false);
      if (lookupFileInput.current) lookupFileInput.current.value = "";
      setLookupNotice(payload.warning ? `PDF kaydedildi. ${payload.warning}` : "PDF mevcut doğrulama sayfasında güncellendi. QR adresi değişmedi.");
      setListReload((value) => value + 1);
    } catch (failure) { setLookupError(failure instanceof Error ? failure.message : "PDF eklenemedi."); }
    finally { setAttachBusy(false); }
  }

  async function removeDocument() {
    if (!found?.hasFile || attachBusy || !window.confirm(`${found.details.documentNumber} numaralı belgenin PDF dosyasını doğrulama sayfasından kaldırmak istiyor musunuz?`)) return;
    setAttachBusy(true); setLookupError(""); setLookupNotice("");
    try {
      const data = new FormData(); data.set("mode", "remove"); data.set("documentNumber", found.details.documentNumber); data.set("confirmed", "true");
      const response = await fetch("/api/qr-documents/ay-tercume", { method: "POST", body: data });
      const payload = await response.json() as { error?: string; warning?: string | null };
      if (!response.ok) throw new Error(payload.error || "PDF kaldırılamadı.");
      setFound({ ...found, hasFile: false });
      setResult((current) => current && current.pageUrl === found.url ? { ...current, hasFile: false } : current);
      setLookupFile(null); setAttachConfirmed(false);
      if (lookupFileInput.current) lookupFileInput.current.value = "";
      setLookupNotice(payload.warning ? `PDF sayfadan kaldırıldı. ${payload.warning}` : "PDF kaldırıldı; aynı QR adresinde evrak bekleniyor mesajı gösteriliyor.");
      setListReload((value) => value + 1);
    } catch (failure) { setLookupError(failure instanceof Error ? failure.message : "PDF kaldırılamadı."); }
    finally { setAttachBusy(false); }
  }

  async function createLanding() {
    if (landingBusy) return;
    setLandingBusy(true); setError("");
    try {
      const response = await fetch("/api/qr-documents/ay-tercume/landing", { method: "POST" });
      const payload = await response.json() as { error?: string; url?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || "Giriş sayfası oluşturulamadı.");
      setLandingUrl(payload.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Giriş sayfası oluşturulamadı.");
    } finally { setLandingBusy(false); }
  }

  async function downloadPng() {
    if (!result || !ready) return;
    setBusy(true); setError("");
    try { downloadFile(await pngFromSvg(result.label.labelUrl), `ay-tercume-${result.details.documentNumber}-qr.png`); }
    catch { setError("PNG indirilemedi. SVG seçeneğini deneyin."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="qr-proto-heading"><div><p className="qr-eyebrow">AY TERCÜME · BELGE YÖNETİMİ</p><h1>QR Dosya Doğrulama</h1><p>Belgeyi kaydedin, aytercume.com doğrulama sayfasını ve QR etiketini oluşturun.</p></div><span className="qr-live-status"><i /> WordPress bağlantılı</span></div>
    <div className="qr-proto-notice qr-public-notice"><span aria-hidden="true">i</span><p>PDF olmadan da belgeye özel sayfa ve QR oluşur. Müşteri adı hemen, PDF eklediğinizde dosyanın kendisi aytercume.com üzerinde herkese açık görünür. Yalnızca kontrol ettiğiniz belge için doğrulama kaydı oluşturun.</p></div>

    <div className="qr-proto-grid">
      <section className="qr-form-panel" aria-labelledby="qr-form-title">
        <div className="qr-panel-heading"><div><small>01 · BELGE BİLGİLERİ</small><h2 id="qr-form-title">Yeni doğrulama kaydı</h2></div></div>
        <form onSubmit={generate}>
          <fieldset disabled={busy}>
            <div className="qr-fields-two">
              <label>Belge numarası <span>*</span><input ref={numberInput} value={form.documentNumber} onChange={(event) => change("documentNumber", event.target.value)} required maxLength={64} placeholder="Örn. AYT2026009" autoComplete="off" /></label>
              <label>Belge tarihi <span>*</span><input type="date" value={form.documentDate} onChange={(event) => change("documentDate", event.target.value)} required /></label>
            </div>
            <label>Müşteri <span>*</span><input value={form.customer} onChange={(event) => change("customer", event.target.value)} required maxLength={120} placeholder="Müşteri adı veya firma unvanı" autoComplete="off" /><small>Doğrulama sayfasında herkese açık görünür.</small></label>
            <label>Belge türü<select value={form.documentType} onChange={(event) => change("documentType", event.target.value)}><option>Tercüme belgesi</option><option>Diploma / eğitim belgesi</option><option>Resmî evrak</option><option>Sözleşme</option><option>Diğer</option></select></label>
            <label>Doğrulanmış PDF <em>İsteğe bağlı</em><input ref={fileInput} className="qr-file-input" type="file" accept=".pdf,application/pdf" onChange={(event) => { setFile(event.target.files?.[0] || null); setError(""); setNotice(""); }} /><small>En fazla 8 MB. Şimdi ekleyebilir veya sayfayı oluşturup dosyayı daha sonra yükleyebilirsiniz.</small></label>
            <label className="qr-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /><span>Bu belgeyi kontrol ettim. Müşteri adı ve eklersem PDF’nin herkese açık yayımlanacağını kabul ediyorum.</span></label>
          </fieldset>
          {error ? <p className="qr-form-error" role="alert">{error}{existingUrl ? <> <a href={existingUrl} target="_blank" rel="noopener noreferrer">Mevcut sayfayı aç ↗</a></> : null}</p> : null}
          <div className="qr-form-actions"><button className="qr-primary-button" type="submit" disabled={busy || ready}><QrIcon size={17} />{busy ? "WordPress sayfası hazırlanıyor…" : ready ? "Sayfa ve QR hazır" : "Sayfayı yayımla ve QR oluştur"}</button><button className="qr-secondary-button" type="button" disabled={busy} onClick={reset}>Yeni belge</button></div>
        </form>
      </section>

      <section className="qr-label-panel" aria-labelledby="qr-label-title">
        <div className="qr-panel-heading"><div><small>02 · DOĞRULAMA ETİKETİ</small><h2 id="qr-label-title">QR ve sayfa bağlantısı</h2></div><span className="qr-size-badge">70 × 45 mm</span></div>
        <div className="qr-label-stage">{result ? <img className="qr-generated-label" src={result.label.labelUrl} alt={`Ay Tercüme belge ${result.details.documentNumber} QR etiketi`} /> : <div className="qr-label-empty"><span><QrIcon size={48} /></span><strong>QR etiketi burada görünecek</strong><p>Belge bilgilerini kaydettiğinizde<br />WordPress sayfası oluşturulur.</p></div>}</div>
        <div aria-live="polite" className={`qr-label-feedback${dirty ? " is-dirty" : ""}`}>{dirty ? "Bilgiler değişti. Mevcut etiket önce yayımlanan sayfaya aittir; yeni kayıt oluşturmadan önce alanları kontrol edin." : notice || "QR doğrudan aytercume.com üzerindeki belge sayfasına gider."}</div>
        {result ? <p className="qr-live-link"><strong>Doğrulama sayfası · {result.hasFile ? "PDF yüklü" : "PDF bekleniyor"}</strong><a href={result.pageUrl} target="_blank" rel="noopener noreferrer">{result.pageUrl} ↗</a></p> : null}
        <div className="qr-label-actions"><button type="button" className="qr-primary-button" disabled={!ready} onClick={() => window.print()}>Etiketi yazdır</button><button type="button" className="qr-secondary-button" disabled={!ready} onClick={() => void downloadPng()}>PNG indir</button><button type="button" className="qr-secondary-button" disabled={!ready} onClick={() => { if (result) downloadFile(result.label.labelUrl, `ay-tercume-${result.details.documentNumber}-qr.svg`); }}>SVG indir</button></div>
        <p className="qr-print-help">Baskıda “gerçek boyut / %100” seçin. QR kodu yayımlanmış WordPress sayfasını açar.</p>
      </section>
    </div>

    <section className="qr-demo-list" aria-labelledby="qr-records-title"><div className="qr-list-heading"><div><h2 id="qr-records-title">Belge kayıtları <span>{records.length}</span></h2><p>Önceden yayımlanan Ay Tercüme doğrulama sayfaları da burada görünür.</p></div><div className="qr-list-tools"><input aria-label="Belge kayıtlarında ara" placeholder="Belge no veya müşteri ara" value={listQuery} onChange={(event) => { setListQuery(event.target.value); setListPage(1); }} /><button type="button" className="qr-secondary-button" onClick={() => setListReload((value) => value + 1)} disabled={listBusy}>Yenile</button></div></div>
      {listError ? <p className="qr-form-error" role="alert">{listError}</p> : null}
      {listBusy ? <p className="qr-list-message">Kayıtlar yükleniyor…</p> : records.length ? <div className="qr-table-scroll"><table><thead><tr><th>Belge no</th><th>Müşteri</th><th>Belge türü</th><th>PDF</th><th>Sayfa / QR</th><th>İşlem</th></tr></thead><tbody>{records.map((entry) => <tr key={entry.url} className={found?.url === entry.url ? "is-selected" : ""}><td><strong>{entry.details.documentNumber}</strong><small>{entry.details.documentDate.split("-").reverse().join(".")}</small></td><td>{entry.details.customer}</td><td>{entry.details.documentType}</td><td><span className={`qr-record-status${entry.hasFile ? " is-complete" : ""}`}>{entry.hasFile ? "PDF yüklü" : "PDF bekleniyor"}</span></td><td><a href={entry.url} target="_blank" rel="noopener noreferrer">Sayfayı aç ↗</a></td><td><button type="button" className="qr-text-button" onClick={() => void selectRecord(entry)}>Kaydı / QR’ı aç</button></td></tr>)}</tbody></table></div> : <p className="qr-list-message">{listQuery ? "Aramayla eşleşen kayıt bulunamadı." : "Bu sayfada kayıt yok."}</p>}
      <div className="qr-pagination"><button type="button" className="qr-secondary-button" disabled={listBusy || listPage <= 1} onClick={() => setListPage((value) => value - 1)}>Önceki</button><span>Sayfa {listPage}</span><button type="button" className="qr-secondary-button" disabled={listBusy || !hasMore} onClick={() => setListPage((value) => value + 1)}>Sonraki</button></div>
    </section>

    <section className="qr-update-card" aria-labelledby="qr-update-title"><div className="qr-panel-heading"><div><small>03 · PDF YÖNETİMİ</small><h2 id="qr-update-title">Kayıtlı belgenin PDF’si</h2></div></div><p className="qr-update-intro">Listeden bir kayıt açın veya belge numarasıyla arayın. PDF ekleyebilir, değiştirebilir veya kaldırabilirsiniz; basılmış QR adresi aynı kalır.</p>
      <form className="qr-update-search" onSubmit={lookupDocument}><label>Belge numarası<input value={lookupNumber} onChange={(event) => { setLookupNumber(event.target.value); setFound(null); setLookupError(""); setLookupNotice(""); }} required maxLength={64} placeholder="Örn. AYT2026009" /></label><button type="submit" className="qr-secondary-button" disabled={lookupBusy || attachBusy}>{lookupBusy ? "Aranıyor…" : "Kaydı bul"}</button></form>
      {found ? <div className="qr-found-record"><div><small>MEVCUT WORDPRESS SAYFASI</small><strong>{found.details.documentNumber} · {found.details.customer}</strong><span>{found.details.documentDate.split("-").reverse().join(".")} · {found.details.documentType}</span><a href={found.url} target="_blank" rel="noopener noreferrer">Doğrulama sayfasını aç ↗</a></div><span className={`qr-record-status${found.hasFile ? " is-complete" : ""}`}>{found.hasFile ? "PDF yüklü" : "PDF bekleniyor"}</span></div> : null}
      {found ? <form className="qr-attach-form" onSubmit={attachDocument}><label>{found.hasFile ? "Yerine yüklenecek yeni PDF" : "Bu kayda eklenecek PDF"} <span>*</span><input ref={lookupFileInput} className="qr-file-input" type="file" accept=".pdf,application/pdf" required onChange={(event) => { setLookupFile(event.target.files?.[0] || null); setLookupError(""); }} /><small>En fazla 8 MB. Dosya herkese açık doğrulama sayfasında gösterilir.</small></label><label className="qr-confirm"><input type="checkbox" checked={attachConfirmed} onChange={(event) => setAttachConfirmed(event.target.checked)} required /><span>Bu PDF’nin doğru belgeye ait olduğunu kontrol ettim ve herkese açık yayımlanacağını kabul ediyorum.</span></label><div className="qr-form-actions"><button type="submit" className="qr-primary-button" disabled={attachBusy}>{attachBusy ? "PDF kaydediliyor…" : found.hasFile ? "PDF’yi değiştir" : "PDF ekle"}</button>{found.hasFile ? <button type="button" className="qr-danger-button" disabled={attachBusy} onClick={() => void removeDocument()}>PDF’yi kaldır</button> : null}</div></form> : null}
      {lookupError ? <p className="qr-form-error" role="alert">{lookupError}</p> : null}{lookupNotice ? <p className="qr-update-success" role="status">{lookupNotice}</p> : null}
    </section>

    <section className="qr-landing-card" aria-labelledby="qr-landing-title"><div><small>AYTERCUME.COM · GİRİŞ SAYFASI</small><h2 id="qr-landing-title">Genel belge doğrulama sayfası</h2><p>Bu sayfa ziyaretçilere QR doğrulama akışını ve Ankara/İstanbul iletişim bilgilerini açıklar. Belgeye özel sayfalar ayrıca oluşturulur.</p>{landingUrl ? <a href={landingUrl} target="_blank" rel="noopener noreferrer">{landingUrl} ↗</a> : null}</div><button type="button" className="qr-secondary-button" disabled={landingBusy || busy} onClick={() => void createLanding()}>{landingBusy ? "Oluşturuluyor…" : "Giriş sayfasını oluştur / aç"}</button></section>
    {result && !dirty ? <div className="qr-print-only"><img src={result.label.labelUrl} alt="Ay Tercüme QR doğrulama etiketi" /></div> : null}
  </>;
}
