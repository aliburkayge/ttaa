import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont } from "pdf-lib";
import { appFile } from "./app-files";

/**
 * Çevirinin yazıldığı yazı tipleri. Tinos ve Arimo, Times New Roman ve
 * Arial'in ölçüleriyle birebir aynı açık lisanslı (OFL) karşılıklarıdır:
 * resmi yazışmaların ezici çoğunluğu bu iki aileden biriyle yazılır.
 */
export type Family = "serif" | "sans";

const FILES: Record<Family, { regular: string; bold: string }> = {
  serif: { regular: "Tinos-Regular.ttf", bold: "Tinos-Bold.ttf" },
  sans: { regular: "Arimo-Regular.ttf", bold: "Arimo-Bold.ttf" },
};

const files = new Map<string, Uint8Array>();

function fontFile(name: string): Uint8Array {
  let bytes = files.get(name);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(appFile(`lib/ceviri/fonts/${name}`)));
    files.set(name, bytes);
  }
  return bytes;
}

/**
 * Belgeye gerektiğinde gömülen yazı tipleri. Tam gömme: pdf-lib'in alt küme
 * gömmesi bu yazı tiplerinde harfleri düşürüyordu. Kullanılmayan aile
 * gömülmez; her biri çıktıya yarım megabayt ekler.
 */
export function fontsFor(doc: PDFDocument): (family: Family, bold: boolean) => Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  const embedded = new Map<string, Promise<PDFFont>>();
  return (family, bold) => {
    const name = FILES[family][bold ? "bold" : "regular"];
    let font = embedded.get(name);
    if (!font) {
      font = doc.embedFont(fontFile(name));
      embedded.set(name, font);
    }
    return font;
  };
}

/** Tek satırlık bir ölçüm: taramadaki mürekkebin genişliği, kaynak metin ve tahmini punto. */
export type WidthSample = { text: string; width: number; size: number; bold: boolean };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Belgenin yazı tipi ailesi, yazının genişliğinden: aynı metin aynı puntoda
 * Arial'de Times'tan yaklaşık %12 geniştir. Her satır için taramadaki
 * genişliğin iki aileden hangisine yakın olduğu 0 (Times) – 1 (Arial)
 * arasında ölçülür; ortanca karar verir. Tek satırlık serif/tırnak
 * incelemesi taramada güvenilmezdi (denendi, geri alındı); belge boyunca
 * onlarca satırın ortancası güvenilirdir. Karar verilemezse serif kalır.
 */
export async function classifyFamily(samples: WidthSample[]): Promise<{ family: Family; score: number | null; samples: number }> {
  const usable = samples.filter((sample) => sample.text.replace(/\s+/g, "").length >= 6 && sample.width > 0 && sample.size > 0);
  if (usable.length < 3) return { family: "serif", score: null, samples: usable.length };

  const doc = await PDFDocument.create();
  const font = fontsFor(doc);
  const scores: number[] = [];
  for (const sample of usable) {
    try {
      const serif = (await font("serif", sample.bold)).widthOfTextAtSize(sample.text, sample.size);
      const sans = (await font("sans", sample.bold)).widthOfTextAtSize(sample.text, sample.size);
      const spread = Math.log(sans) - Math.log(serif);
      // İki ailede aynı genişlikteki metin (ör. yalnız rakamlar) bir şey söylemez.
      if (!(serif > 0 && sans > 0) || Math.abs(spread) < 0.03) continue;
      scores.push((Math.log(sample.width) - Math.log(serif)) / spread);
    } catch {
      // yazı tipinde olmayan karakter: bu satır oy vermez
    }
  }
  if (scores.length < 3) return { family: "serif", score: null, samples: scores.length };
  const score = median(scores);
  return { family: score > 0.5 ? "sans" : "serif", score, samples: scores.length };
}
