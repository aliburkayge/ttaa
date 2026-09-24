import type { Raster } from "./ink-marks";

/**
 * Taranmış sayfadaki düz çizgiler: imza çizgisi, tablo kenarı, alt çizgi.
 *
 * İmza ya da mühür silinirken çizginin üstünden geçen kısmı da gider; çizgi
 * kesik kesik kalıyordu (NJ mektubu). Çizgi burada bir kez, silmeden önce
 * modellenir (doğru, kalınlık, renk) ve silinen yerde bu modelden yeniden
 * çizilir; kalite ölçer de çıktıda çizginin sürekliliğini buna göre ölçer.
 *
 * Tarama hafif eğiktir: çizgi tek bir piksel satırına düşmez, basamak
 * basamak iner. Her satırda uzun koyu koşular bulunur, bitişik satırlarda
 * çakışan koşular birleştirilir, parça en küçük karelerle doğruya oturtulur.
 */

export type RuleLine = {
  orientation: "h" | "v";
  /** Yatayda y = a + b·x; dikeyde x = a + b·y (piksel). */
  a: number;
  b: number;
  /** Ana eksendeki uçlar (piksel): yatayda x, dikeyde y. */
  start: number;
  end: number;
  /** Kalınlık (piksel). */
  thickness: number;
  color: [number, number, number];
};

/** Çizginin ana eksendeki bir noktada karşı eksendeki konumu. */
export function ruleAt(rule: RuleLine, along: number): number {
  return rule.a + rule.b * along;
}

export const RULES = {
  /** Satır başına koşunun en kısa boyu (punto): harfler bundan kısadır. */
  minRun: 8,
  /** Çizginin en kısa boyu (punto). */
  minLength: 24,
  /** En kalın çizgi (punto). */
  maxThickness: 4,
  /** Renkli çizgi bundan kısaysa (punto) imzanın düz kuyruğudur. */
  coloredMinLength: 60,
  /** Aynı doğrudaki iki parça arasındaki en büyük boşluk (punto): tarama kopukluğu. */
  maxGap: 3,
  /** İki yanı birlikte koyu sütunların en büyük payı: fazlası yazı satırıdır. */
  maxTextSides: 0.25,
};

type Run = { cross: number; from: number; to: number };

/**
 * Sayfadaki yatay ve dikey düz çizgiler. `pixelsPerPoint` punto ölçülerini
 * piksele çevirir.
 */
export function findRules(raster: Raster, pixelsPerPoint: number, rules = RULES): RuleLine[] {
  const { w, h, rgb } = raster;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  const sample: number[] = [];
  for (let i = 0; i < w * h; i += 7) sample.push(lum[i]);
  sample.sort((a, b) => a - b);
  const paper = sample[Math.floor(sample.length * 0.6)] ?? 255;
  const threshold = Math.min(170, paper - 60);
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (lum[i] < threshold) dark[i] = 1;

  return [...detect("h"), ...detect("v")];

  function detect(orientation: "h" | "v"): RuleLine[] {
    // Ana eksen: çizginin uzandığı yön. Yatayda satır satır (cross = y), dikeyde sütun sütun.
    const mainSize = orientation === "h" ? w : h;
    const crossSize = orientation === "h" ? h : w;
    const at = (main: number, cross: number) => (orientation === "h" ? cross * w + main : main * w + cross);
    const minRun = Math.max(6, Math.round(rules.minRun * pixelsPerPoint));

    const runs: Run[] = [];
    const byCross: number[][] = Array.from({ length: crossSize }, () => []);
    for (let cross = 0; cross < crossSize; cross++) {
      let main = 0;
      while (main < mainSize) {
        if (!dark[at(main, cross)]) {
          main++;
          continue;
        }
        const from = main;
        let last = main;
        // Bir piksellik kopukluk (tarama gürültüsü) koşuyu bölmez.
        while (main < mainSize && (dark[at(main, cross)] || (main + 1 < mainSize && dark[at(main + 1, cross)]))) {
          if (dark[at(main, cross)]) last = main;
          main++;
        }
        if (last - from + 1 >= minRun) {
          byCross[cross].push(runs.length);
          runs.push({ cross, from, to: last });
        }
      }
    }

    // Bitişik satırlarda çakışan ya da değen koşular aynı çizgidir.
    const parent = runs.map((_, index) => index);
    const find = (index: number): number => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    for (let cross = 1; cross < crossSize; cross++) {
      for (const a of byCross[cross]) {
        for (const b of byCross[cross - 1]) {
          if (runs[a].from - 1 <= runs[b].to && runs[b].from <= runs[a].to + 1) parent[find(a)] = find(b);
        }
      }
    }
    const groups = new Map<number, Run[]>();
    runs.forEach((run, index) => {
      const root = find(index);
      groups.set(root, [...(groups.get(root) ?? []), run]);
    });

    const found: RuleLine[] = [];
    for (const group of groups.values()) {
      const line = fit(group);
      if (line) found.push(line);
    }
    return merge(found);

    function fit(group: Run[]): RuleLine | null {
      const start = Math.min(...group.map((run) => run.from));
      const end = Math.max(...group.map((run) => run.to));
      if (end - start + 1 < rules.minLength * pixelsPerPoint) return null;
      // Sütun başına koşu piksellerinin ortalama konumu ve sayısı.
      const sum = new Float64Array(end - start + 1);
      const count = new Uint32Array(end - start + 1);
      for (const run of group) {
        for (let main = run.from; main <= run.to; main++) {
          sum[main - start] += run.cross;
          count[main - start]++;
        }
      }
      let n = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < count.length; i++) {
        if (!count[i]) continue;
        const x = start + i;
        const y = sum[i] / count[i];
        n++;
        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
      }
      const denominator = n * sxx - sx * sx;
      const b = denominator ? (n * sxy - sx * sy) / denominator : 0;
      const a = (sy - b * sx) / n;
      // Düz mü: sütun ortalamaları doğrudan en çok 1,5 piksel sapar.
      let squared = 0;
      for (let i = 0; i < count.length; i++) {
        if (count[i]) squared += (sum[i] / count[i] - (a + b * (start + i))) ** 2;
      }
      if (Math.sqrt(squared / n) > 1.5 + 0.02 * pixelsPerPoint) return null;
      const thickness = median([...count].filter(Boolean));
      if (thickness > rules.maxThickness * pixelsPerPoint) return null;
      // Kesit: çizginin iki yanı neredeyse her yerde kağıttır. Kalın büyük harfli
      // satırda harfler bandın hem üstüne hem altına taşar; kaba rasterde
      // birbirine değen harfler çizgi sanılıyor, çevirinin üstüne kalın çizgi
      // çekiliyordu (Priaxor 1. sayfa başlığı). İmzanın çizgiyi kestiği yer azdır.
      const side = thickness / 2 + Math.max(2, 0.8 * pixelsPerPoint);
      let both = 0;
      let sampled = 0;
      for (let main = start; main <= end; main++) {
        const center = a + b * main;
        const above = Math.round(center - side);
        const below = Math.round(center + side);
        if (above < 0 || below >= crossSize) continue;
        sampled++;
        if (dark[at(main, above)] && dark[at(main, below)]) both++;
      }
      if (sampled && both / sampled > rules.maxTextSides) return null;

      // Renk: çizginin ortasındaki pikseller.
      const reds: number[] = [];
      const greens: number[] = [];
      const blues: number[] = [];
      for (let main = start; main <= end; main += 2) {
        const cross = Math.round(a + b * main);
        if (cross < 0 || cross >= crossSize) continue;
        const index = at(main, cross);
        if (!dark[index]) continue;
        reds.push(rgb[index * 3]);
        greens.push(rgb[index * 3 + 1]);
        blues.push(rgb[index * 3 + 2]);
      }
      const color: [number, number, number] = [median(reds), median(greens), median(blues)];
      const chroma = Math.max(...color) - Math.min(...color);
      if (chroma > 40 && end - start + 1 < rules.coloredMinLength * pixelsPerPoint) return null;
      return { orientation, a, b, start, end, thickness, color };
    }

    // Aynı doğrudaki parçalar arasındaki küçük kopukluk (tarama) birleştirilir;
    // yan yana iki imza çizgisi gibi gerçek boşluklar ayrı kalır.
    function merge(lines: RuleLine[]): RuleLine[] {
      const gap = rules.maxGap * pixelsPerPoint;
      const sorted = [...lines].sort((p, q) => p.start - q.start);
      const out: RuleLine[] = [];
      for (const line of sorted) {
        const previous = out.find(
          (other) =>
            line.start - other.end <= gap &&
            line.start >= other.start &&
            Math.abs(ruleAt(other, line.start) - ruleAt(line, line.start)) <= 2 &&
            Math.max(other.thickness, line.thickness) <= 2 * Math.min(other.thickness, line.thickness),
        );
        if (!previous) {
          out.push(line);
          continue;
        }
        const length = (rule: RuleLine) => rule.end - rule.start + 1;
        const weight = length(previous) + length(line);
        previous.b = (previous.b * length(previous) + line.b * length(line)) / weight;
        previous.a = ruleAt(previous, previous.start) - previous.b * previous.start;
        previous.end = Math.max(previous.end, line.end);
        previous.thickness = (previous.thickness * length(previous) + line.thickness * length(line)) / weight;
      }
      return out;
    }
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
