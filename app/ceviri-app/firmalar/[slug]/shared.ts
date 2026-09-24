/** Firma sayfasının sekmelerinin paylaştığı tipler ve yardımcılar. */

import { useEffect } from "react";

export type FirmClient = { id: string; name: string; slug: string; aliases: string[]; instructions: string | null };

export const LANGS = ["en-US", "en-GB", "tr-TR", "de-DE", "fr-FR", "es-ES", "it-IT", "ru-RU", "el-GR", "pl-PL"];

export const number = (value: number) => value.toLocaleString("tr-TR");

/** Yanıtı okur; başarısızsa sunucunun hata mesajıyla fırlatır. */
export async function readJson(res: Response, fallback: string) {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? fallback);
  return payload;
}

/** Etkide veri yükleme: ilk çizimden sonra, bileşen kapanınca sonuç yok sayılır. */
export function useLoad(load: () => Promise<void>) {
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
}
