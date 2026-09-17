"use client";

import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { verifiedPageUrl, type VerificationBrand } from "../../../lib/public-verification";
import styles from "./widget.module.css";

type Match = { url: string; documentNumber?: string; hasFile?: boolean };

export default function VerificationWidget({ brand }: { brand: VerificationBrand }) {
  const english = brand === "ttaa";
  const [number, setNumber] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupMatch, setLookupMatch] = useState<Match | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [qrLookupBusy, setQrLookupBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanMatch, setScanMatch] = useState<Match | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scanActiveRef = useRef(false);

  useEffect(() => () => { scanActiveRef.current = false; controlsRef.current?.stop(); }, []);

  function stopScan() {
    scanActiveRef.current = false;
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }

  async function verifyQr(value: string) {
    const url = verifiedPageUrl(brand, value);
    if (!url) {
      setScanError(english ? "This QR code is not a TTAA verification link." : "Bu QR kodu AY Tercüme doğrulama bağlantısı değil.");
      return;
    }
    setQrLookupBusy(true); setScanError(""); setScanMatch(null);
    try {
      const response = await fetch("/api/public-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand, qrUrl: url }), cache: "no-store" });
      if (response.status === 404) { setScanError(english ? "No published record was found for this QR code." : "Bu QR koduyla yayımlanmış belge bulunamadı."); return; }
      const result = await response.json() as { url?: string; documentNumber?: string; hasFile?: boolean };
      if (!response.ok || result.url !== url) throw new Error();
      setScanMatch({ url, documentNumber: result.documentNumber, hasFile: result.hasFile });
    } catch {
      setScanError(english ? "Verification is temporarily unavailable. Please try again." : "Doğrulama şu anda yapılamıyor. Lütfen tekrar deneyin.");
    } finally { setQrLookupBusy(false); }
  }

  async function startScan() {
    if (scanBusy || scanning) return;
    setScanBusy(true); setScanError(""); setScanMatch(null);
    scanActiveRef.current = true;
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" }, audio: false }, videoRef.current!, (result, _error, callbackControls) => {
        if (!scanActiveRef.current || !result) return;
        const url = verifiedPageUrl(brand, result.getText());
        if (!url) {
          setScanError(english ? "This QR code is not a TTAA verification link." : "Bu QR kodu AY Tercüme doğrulama bağlantısı değil.");
          return;
        }
        callbackControls.stop();
        scanActiveRef.current = false;
        controlsRef.current = null;
        setScanning(false);
        void verifyQr(url);
      });
      if (!scanActiveRef.current) controls.stop();
      else { controlsRef.current = controls; setScanning(true); }
    } catch {
      scanActiveRef.current = false;
      setScanError(english ? "Camera unavailable. Allow camera access or choose a QR image." : "Kamera açılamadı. Kamera izni verin veya QR görseli seçin.");
    } finally { setScanBusy(false); }
  }

  async function scanImage(file?: File) {
    if (!file) return;
    stopScan(); setScanError(""); setScanMatch(null); setScanBusy(true);
    const imageUrl = URL.createObjectURL(file);
    try {
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(imageUrl);
      await verifyQr(result.getText());
    } catch {
      setScanError(english ? "No readable QR code was found in this image." : "Görselde okunabilir bir QR kodu bulunamadı.");
    } finally { URL.revokeObjectURL(imageUrl); setScanBusy(false); }
  }

  async function lookUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = number.trim();
    if (!clean || clean.length > 64) return;
    setLookupBusy(true); setLookupError(""); setLookupMatch(null);
    try {
      const response = await fetch("/api/public-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand, documentNumber: clean }), cache: "no-store" });
      if (response.status === 404) { setLookupError(english ? "No published record was found for this number." : "Bu numarayla yayımlanmış belge bulunamadı."); return; }
      const result = await response.json() as { url?: string; documentNumber?: string; hasFile?: boolean };
      if (!response.ok || !result.url || !verifiedPageUrl(brand, result.url)) throw new Error();
      setLookupMatch({ url: result.url, documentNumber: result.documentNumber, hasFile: result.hasFile });
    } catch {
      setLookupError(english ? "Verification is temporarily unavailable. Please try again." : "Sorgulama şu anda yapılamıyor. Lütfen tekrar deneyin.");
    } finally { setLookupBusy(false); }
  }

  const resultLink = (match: Match) => <div className={styles.result} role="status"><span className={styles.resultDot} aria-hidden="true" /><div><strong>{english ? "Verification page found" : "Doğrulama sayfası bulundu"}</strong>{match.documentNumber ? <small>{match.documentNumber}{match.hasFile === false ? english ? " · PDF pending" : " · PDF bekleniyor" : ""}</small> : null}<a href={match.url} target="_top" rel="noopener noreferrer">{english ? "Open document page ↗" : "Belge sayfasını aç ↗"}</a></div></div>;

  return <main className={`${styles.widget} ${english ? styles.ttaa : styles.ay}`} lang={english ? "en" : "tr"}>
    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="scan-title">
        <div className={styles.cardTop}><span className={styles.icon} aria-hidden="true">⌗</span><span className={styles.step}>01</span></div>
        <h2 id="scan-title">{english ? "Scan QR code" : "QR kodu okut"}</h2>
        <p>{english ? "Point your camera at the QR code on the document, or choose a QR image." : "Belgedeki QR koduna kameranızı tutun veya QR görselini seçin."}</p>
        <div className={`${styles.preview} ${scanning ? styles.previewActive : ""}`}><video ref={videoRef} muted playsInline aria-label={english ? "QR camera preview" : "QR kamera görüntüsü"} /><span>{scanning ? english ? "Scanning…" : "Taranıyor…" : english ? "Camera preview" : "Kamera görüntüsü"}</span></div>
        <div className={styles.actions}><button type="button" className={styles.primary} onClick={scanning ? stopScan : () => void startScan()} disabled={scanBusy}>{scanning ? english ? "Stop camera" : "Kamerayı kapat" : scanBusy ? english ? "Starting…" : "Açılıyor…" : english ? "Open camera" : "Kamerayı aç"}</button><label className={styles.secondary}>{english ? "Choose QR image" : "QR görseli seç"}<input type="file" accept="image/*" onChange={(event) => { void scanImage(event.target.files?.[0]); event.target.value = ""; }} /></label></div>
        {qrLookupBusy ? <p className={styles.checking} role="status">{english ? "Checking the official record…" : "Resmî kayıt kontrol ediliyor…"}</p> : null}
        {scanError ? <p className={styles.error} role="alert">{scanError}</p> : null}
        {scanMatch ? resultLink(scanMatch) : null}
      </section>
      <section className={styles.card} aria-labelledby="number-title">
        <div className={styles.cardTop}><span className={styles.icon} aria-hidden="true">№</span><span className={styles.step}>02</span></div>
        <h2 id="number-title">{english ? "Search by document number" : "Belge numarasıyla sorgula"}</h2>
        <p>{english ? "Enter the number printed on your document to find its official verification page." : "Resmî doğrulama sayfasını bulmak için belgenizdeki numarayı girin."}</p>
        <form onSubmit={(event) => void lookUp(event)} className={styles.form}><label htmlFor="verification-number">{english ? "Document number" : "Belge numarası"}</label><input id="verification-number" value={number} onChange={(event) => { setNumber(event.target.value); setLookupError(""); setLookupMatch(null); }} maxLength={64} required autoComplete="off" placeholder={english ? "Enter document number" : "Belge numarasını girin"} /><button className={styles.primary} disabled={lookupBusy} type="submit">{lookupBusy ? english ? "Searching…" : "Sorgulanıyor…" : english ? "Find document" : "Belgeyi sorgula"}</button></form>
        {lookupError ? <p className={styles.error} role="alert">{lookupError}</p> : null}
        {lookupMatch ? resultLink(lookupMatch) : null}
      </section>
    </div>
  </main>;
}
