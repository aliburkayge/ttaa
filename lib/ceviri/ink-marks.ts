/**
 * OCR'ın ayrı bölge olarak vermediği imza ve mühürleri taramanın kendisinden
 * bulur. Müşteri mektuplarında (BASF) imza basılı ismin üstünden geçen mavi
 * mürekkeptir; OCR onu görsel diye ayırmaz, bazen yazı sanıp okur.
 *
 * Aday: harf boyunu belirgin şekilde aşan ya da renkli mürekkep kümeleri.
 * Uzun düz çizgiler (tablo, imza çizgisi, alt çizgi) önce ayıklanır, yoksa
 * imza değdiği çizgiyle tek parça olup çizgi sanılırdı. Karar burada verilmez:
 * her bölge sınıflandırıcıya gider; logo ya da basılı yazı ise dokunulmaz.
 */

export type Raster = { w: number; h: number; rgb: Uint8Array };

export type InkRegion = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Bölgenin kendi ızgarasında (x1-x0+1 genişlik) silinecek pikseller: 1. */
  bits: Uint8Array;
  colored: boolean;
  /** Bölgenin çevresindeki kağıt rengi. */
  paper: [number, number, number];
};

export type InkMap = {
  w: number;
  h: number;
  ink: Uint8Array;
  /** Uzun düz koşu (tablo, imza çizgisi) pikselleri. */
  rule: Uint8Array;
  mark: Uint8Array;
  regions: InkRegion[];
};

/** Bundan uzun düz mürekkep koşusu çizgidir (punto). */
const RULE_PT = 24;
/** Renkli imzanın düz kuyruğu en fazla bu kadar uzun olur (punto); daha uzunu renkli çizgidir. */
const FLOURISH_PT = 60;

/** İki renkli işaret tonları bundan fazla ayrıysa (derece) ayrı işaretlerdir: mavi imza, yeşil mühür. */
const HUE_SPLIT = 35;
/** Maskenin soluk haleye doğru en çok kaç hücre büyüdüğü ve kağıttan ne kadar koyu pikseli aldığı. */
const HALO_RINGS = 4;
const HALO_DEPTH = 6;

type Component = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
  chroma: number;
  lum: number;
  /** Ortalama renk. */
  r: number;
  g: number;
  b: number;
};

/** Rengin tonu (0–360 derece). */
function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Renkli mürekkep mi? Doygunluk parlaklığa oranlanır: telefonla çekilmiş
 * sayfada koyu lacivert imza mutlak olarak az doygundur (≈ 40, parlaklık ≈ 35)
 * ama siyah baskının (≈ 8) çok üstündedir. Mutlak eşikle (45) lacivert imza
 * siyah sayılıyor, yalnızca çizginin böldüğü bir parçası bulunuyordu (BASF
 * üretim tesisleri mektubu).
 */
export function tinted(chroma: number, lum: number): boolean {
  return chroma > 45 || (chroma > 20 && chroma > 0.45 * Math.max(40, lum));
}

export function findInkRegions(raster: Raster, pixelsPerPoint: number): InkMap {
  const { w, h, rgb } = raster;
  const ink = new Uint8Array(w * h);
  const chromaAt = new Uint8Array(w * h);
  const lumAt = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    chromaAt[i] = chroma;
    lumAt[i] = Math.round(lum);
    // İnce renkli çizgi açık tonda kalır; siyah eşiğiyle kopuk görünürdü.
    ink[i] = lum < 170 || (chroma > 35 && lum < 225) ? 1 : 0;
  }

  const strokes = ink.slice();
  const run = Math.max(8, Math.round(RULE_PT * pixelsPerPoint));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; ) {
      if (!ink[y * w + x]) { x++; continue; }
      let end = x;
      while (end < w && ink[y * w + end]) end++;
      if (end - x >= run) strokes.fill(0, y * w + x, y * w + end);
      x = end;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; ) {
      if (!ink[y * w + x]) { y++; continue; }
      let end = y;
      while (end < h && ink[end * w + x]) end++;
      if (end - y >= run) for (let k = y; k < end; k++) strokes[k * w + x] = 0;
      y = end;
    }
  }

  // Bağlı bileşenler (8 komşuluk), `on` pikselleri üzerinde.
  const label = (on: Uint8Array) => {
    const labels = new Int32Array(w * h).fill(-1);
    const comps: Component[] = [];
    const stack: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (!on[i] || labels[i] >= 0) continue;
      const c: Component = { x0: w, y0: h, x1: 0, y1: 0, n: 0, chroma: 0, lum: 0, r: 0, g: 0, b: 0 };
      labels[i] = comps.length;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const x = j % w;
        const y = (j - x) / w;
        c.n++;
        c.chroma += chromaAt[j];
        c.lum += lumAt[j];
        c.r += rgb[j * 3];
        c.g += rgb[j * 3 + 1];
        c.b += rgb[j * 3 + 2];
        if (x < c.x0) c.x0 = x;
        if (x > c.x1) c.x1 = x;
        if (y < c.y0) c.y0 = y;
        if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const k = yy * w + xx;
            if (on[k] && labels[k] < 0) {
              labels[k] = comps.length;
              stack.push(k);
            }
          }
        }
      }
      c.chroma /= c.n;
      c.lum /= c.n;
      c.r /= c.n;
      c.g /= c.n;
      c.b /= c.n;
      comps.push(c);
    }
    return { labels, comps };
  };

  const { labels, comps } = label(strokes);

  const heights = comps
    .filter((c) => c.n >= 12)
    .map((c) => c.y1 - c.y0 + 1)
    .sort((a, b) => a - b);
  const glyph = heights[Math.floor(heights.length * 0.6)] ?? Math.round(10 * pixelsPerPoint);

  const candidate = comps.map((c) => {
    const cw = c.x1 - c.x0 + 1;
    const ch = c.y1 - c.y0 + 1;
    if (c.n < 6) return false;
    // Çok ince ve düz: kısa tablo kenarı, çizgi parçası.
    if (cw <= glyph * 0.35 || ch <= glyph * 0.35) return false;
    if (tinted(c.chroma, c.lum) && c.n >= 20) return true;
    return ch > glyph * 1.9 || cw > glyph * 8;
  });

  type Group = { x0: number; y0: number; x1: number; y1: number; n: number; members: number[]; flats: number[] };
  const groups: Group[] = [];
  comps.forEach((c, index) => {
    if (candidate[index]) groups.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, n: c.n, members: [index], flats: [] });
  });
  // Renkli mürekkep neredeyse hiç basılı yazı değildir: aynı imzanın kopuk
  // kuyruğu daha uzaktan da aynı bölgeye katılır.
  const isColored = (group: { members: number[] }) =>
    group.members.some((index) => tinted(comps[index].chroma, comps[index].lum));
  // Grubun renkli mürekkebinin tonu (piksel sayısıyla ağırlıklı ortalama renk).
  const hueOfGroup = (group: { members: number[] }) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const index of group.members) {
      const c = comps[index];
      if (!tinted(c.chroma, c.lum)) continue;
      r += c.r * c.n;
      g += c.g * c.n;
      b += c.b * c.n;
    }
    return hueOf(r, g, b);
  };
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const r = groups[a];
        const s = groups[b];
        const both = isColored(r) && isColored(s);
        // Farklı renkte iki işaret (mavi imza, yeşil mühür) yakın da olsa
        // ayrıdır: tek bölge olunca sınıflandırıcı ikisine tek etiket veriyor,
        // OCR'ın mühür bölgesine değdiği için imza hiç silinmiyordu (Priaxor 2. sayfa).
        if (both && hueGap(hueOfGroup(r), hueOfGroup(s)) > HUE_SPLIT) continue;
        const gapX = glyph * (both ? 6 : 3);
        const gapY = glyph * (both ? 2 : 1.2);
        if (r.x0 - gapX <= s.x1 && s.x0 - gapX <= r.x1 && r.y0 - gapY <= s.y1 && s.y0 - gapY <= r.y1) {
          groups[a] = {
            x0: Math.min(r.x0, s.x0),
            y0: Math.min(r.y0, s.y0),
            x1: Math.max(r.x1, s.x1),
            y1: Math.max(r.y1, s.y1),
            n: r.n + s.n,
            members: [...r.members, ...s.members],
            flats: [],
          };
          groups.splice(b, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // Renkli imzanın uzun ve yatık kuyruğu düz çizgi diye ayıklanmıştı. Renkli
  // ve kısa düz parçalar yakınlarındaki renkli imzaya katılır. Siyah basılı
  // çizgi renkli değildir; renkli tablo çizgisi ise bundan uzundur.
  const flatInk = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (ink[i] && !strokes[i]) flatInk[i] = 1;
  const flat = label(flatInk);
  const flourish = flat.comps.map(
    (c) => c.n >= 6 && tinted(c.chroma, c.lum) && c.x1 - c.x0 + 1 <= FLOURISH_PT * pixelsPerPoint,
  );
  for (const group of groups) {
    if (!isColored(group)) continue;
    for (let grew = true; grew; ) {
      grew = false;
      flat.comps.forEach((c, index) => {
        if (!flourish[index] || group.flats.includes(index)) return;
        const gapX = glyph * 3;
        const gapY = glyph * 1.2;
        if (group.x0 - gapX > c.x1 || c.x0 - gapX > group.x1 || group.y0 - gapY > c.y1 || c.y0 - gapY > group.y1) return;
        group.flats.push(index);
        group.x0 = Math.min(group.x0, c.x0);
        group.y0 = Math.min(group.y0, c.y0);
        group.x1 = Math.max(group.x1, c.x1);
        group.y1 = Math.max(group.y1, c.y1);
        group.n += c.n;
        grew = true;
      });
    }
  }

  // İmzanın dalgalı kuyruğu dalganın tepelerinde düz koşu sayılıp ayıklanır;
  // geriye kalan kısa parçalar da tek başına aday değildir. Kuyruk imzaya
  // değdiği yerden izlenir: imzaya (ya da izlenmiş bir parçaya) değen kısa düz
  // parça ve ona değen mürekkep parçası imzanındır. Basılı çizgi uzun ve düzdür,
  // izlenmez; imzaya değmeyen tablo çizgilerine hiç ulaşılmaz. NJ mektubu 3.
  // sayfa: "Jill C Holihan" imzasının kıvrık kuyruk ucu sayfada kalıyordu.
  {
    const flourishRun = Math.round(FLOURISH_PT * pixelsPerPoint);
    // Kısa düz parça başka bir düz parçayla aynı hizada devam ediyorsa kesik
    // bir çizginin (tablo kenarı, çift çizgi) parçasıdır; dalganın tepesinin
    // yanında aynı hizada düz mürekkep yoktur, kuyruk yukarı ya da aşağı kıvrılır.
    const gap = Math.max(4, Math.round(6 * pixelsPerPoint));
    const continues = (c: Component, index: number) => {
      const horizontal = c.x1 - c.x0 >= c.y1 - c.y0;
      const hit = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < w && y < h && flat.labels[y * w + x] >= 0 && flat.labels[y * w + x] !== index;
      for (let k = 1; k <= gap; k++) {
        if (horizontal) {
          for (let y = c.y0 - 1; y <= c.y1 + 1; y++) if (hit(c.x0 - k, y) || hit(c.x1 + k, y)) return true;
        } else {
          for (let x = c.x0 - 1; x <= c.x1 + 1; x++) if (hit(x, c.y0 - k) || hit(x, c.y1 + k)) return true;
        }
      }
      return false;
    };
    // Düz parça tanımı gereği uzun düz koşulardan oluşur; kuyruğun tepesinden
    // uzunu çizgidir (ya da tablonun dış çerçevesi gibi çizgilerin birleşimi).
    const traceable = flat.comps.map(
      (c, index) => c.n >= 6 && Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1 <= flourishRun && !continues(c, index),
    );
    const claimed = new Set<number>();
    for (const group of groups) for (const f of group.flats) claimed.add(f);
    // Parça komşulukları: düz parça ↔ ona değen mürekkep parçaları.
    const flatToStroke: Array<Set<number>> = flat.comps.map(() => new Set());
    const strokeToFlat = new Map<number, Set<number>>();
    for (let i = 0; i < w * h; i++) {
      const f = flat.labels[i];
      if (f < 0 || !traceable[f]) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const s = labels[yy * w + xx];
          if (s < 0) continue;
          flatToStroke[f].add(s);
          if (!strokeToFlat.has(s)) strokeToFlat.set(s, new Set());
          strokeToFlat.get(s)!.add(f);
        }
      }
    }
    const owner = new Map<number, Group>();
    for (const group of groups) for (const index of group.members) owner.set(index, group);
    for (const group of groups) {
      const queue = [...group.members];
      const seenFlat = new Set(group.flats);
      while (queue.length) {
        const s = queue.pop()!;
        for (const f of strokeToFlat.get(s) ?? []) {
          if (seenFlat.has(f) || claimed.has(f)) continue;
          seenFlat.add(f);
          claimed.add(f);
          group.flats.push(f);
          const c = flat.comps[f];
          group.x0 = Math.min(group.x0, c.x0);
          group.y0 = Math.min(group.y0, c.y0);
          group.x1 = Math.max(group.x1, c.x1);
          group.y1 = Math.max(group.y1, c.y1);
          group.n += c.n;
          for (const next of flatToStroke[f]) {
            // Başka bir bölgenin parçasıysa o bölgeye dokunulmaz.
            if (group.members.includes(next) || (owner.get(next) && owner.get(next) !== group)) continue;
            const piece = comps[next];
            group.members.push(next);
            owner.set(next, group);
            group.x0 = Math.min(group.x0, piece.x0);
            group.y0 = Math.min(group.y0, piece.y0);
            group.x1 = Math.max(group.x1, piece.x1);
            group.y1 = Math.max(group.y1, piece.y1);
            group.n += piece.n;
            queue.push(next);
          }
        }
      }
    }
  }

  const mark = new Uint8Array(w * h);
  const regions: InkRegion[] = [];
  for (const group of groups) {
    const gw = group.x1 - group.x0 + 1;
    const gh = group.y1 - group.y0 + 1;
    if (group.n < glyph * glyph * 1.2 || gw < glyph * 1.5 || gh < glyph * 0.8) continue;

    const members = new Set(group.members);
    const flats = new Set(group.flats);
    const raw = new Uint8Array(gw * gh);
    let colored = 0;
    let total = 0;
    for (let y = group.y0; y <= group.y1; y++) {
      for (let x = group.x0; x <= group.x1; x++) {
        const index = y * w + x;
        if ((labels[index] >= 0 && members.has(labels[index])) || (flat.labels[index] >= 0 && flats.has(flat.labels[index]))) {
          raw[(y - group.y0) * gw + (x - group.x0)] = 1;
          mark[index] = 1;
          total++;
          if (tinted(chromaAt[index], lumAt[index])) colored++;
        }
      }
    }
    // Bir piksel genişletilir: çizginin kenarındaki yumuşak ton da silinsin.
    const bits = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1 && !on; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < gh && xx >= 0 && xx < gw && raw[yy * gw + xx]) on = 1;
          }
        }
        bits[y * gw + x] = on;
      }
    }

    const paper: number[][] = [[], [], []];
    for (let y = Math.max(0, group.y0 - 3); y <= Math.min(h - 1, group.y1 + 3); y++) {
      for (let x = Math.max(0, group.x0 - 3); x <= Math.min(w - 1, group.x1 + 3); x++) {
        const index = y * w + x;
        if (ink[index]) continue;
        for (let k = 0; k < 3; k++) paper[k].push(rgb[index * 3 + k]);
      }
    }
    const median = (values: number[]) => {
      if (!values.length) return 255;
      values.sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    };

    regions.push({
      x0: group.x0,
      y0: group.y0,
      x1: group.x1,
      y1: group.y1,
      bits,
      colored: colored > total * 0.5,
      paper: [median(paper[0]), median(paper[1]), median(paper[2])],
    });
  }

  const rule = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (ink[i] && !strokes[i]) rule[i] = 1;
  return { w, h, ink, rule, mark, regions };
}

type PixelBox = { x0: number; y0: number; x1: number; y1: number };

/**
 * Sınıflandırıcının imza/mühür dediği bölgede silinecek pikseller. Bölgedeki
 * bütün mürekkep alınır (imzanın harf boyundaki parçaları da: "i" noktası,
 * kopuk kuyruk), şunlar hariç:
 *  - `protect`: yerinde kalan basılı satırların alanı,
 *  - düz çizgiler (imza çizgisi, tablo) — `modeled` çizgiler hariç: onlar
 *    işaretle birlikte silinir ve modelden yeniden çizilir (bkz. rules.ts),
 *  - renkli imzada siyah pikseller: mavi imza siyah ismin üstünden geçse de
 *    isim olduğu gibi kalır. Renkli imzanın açık tonlu kenarı ise alınır.
 */
export function markMask(
  raster: Raster,
  map: InkMap,
  box: PixelBox,
  options: {
    colored: boolean;
    protect: PixelBox[];
    /** Bölgeye değen, bundan kısa (piksel) düz parça imzanın kuyruğudur; uzunu basılı çizgidir. */
    shortRule: number;
    /**
     * Modellenmiş, silindikten sonra yeniden çizilecek çizginin pikseli. Böyle
     * bir çizginin üstündeki imza mürekkebi korunmaz: çizgi kesik kalmasın diye
     * çizginin mavimsi pikselleri bırakılınca imza çizginin üstünde iz kalıyordu.
     */
    modeled?: (x: number, y: number) => boolean;
    /**
     * Kağıt noktacıklı (bkz. speckledPaper): siyah işarette yalnızca işaretin
     * kendi mürekkebi alınır, kutudaki her koyu piksel değil. Yoksa kutunun
     * içindeki noktacıklar da gidiyor, imzanın yeri temiz bir dikdörtgen
     * kalıyordu. Kopuk parçaları sweepResidue toplar.
     */
    speckled?: boolean;
  },
): { box: PixelBox; bits: Uint8Array } {
  const run = (x: number, y: number) => {
    let left = x;
    while (left > 0 && map.rule[y * map.w + left - 1]) left--;
    let right = x;
    while (right < map.w - 1 && map.rule[y * map.w + right + 1]) right++;
    return { left, right };
  };
  const bx0 = Math.max(0, Math.floor(box.x0));
  const by0 = Math.max(0, Math.floor(box.y0));
  const bx1 = Math.min(map.w - 1, Math.ceil(box.x1));
  const by1 = Math.min(map.h - 1, Math.ceil(box.y1));
  const tail = (x: number, y: number) => {
    const { left, right } = run(x, y);
    return right - left + 1 <= options.shortRule && right >= bx0 && left <= bx1;
  };
  // Kutunun kenarından dışarı uzanan kısa kuyruk da, ucundaki kıvrımla birlikte kapsansın.
  let x0 = bx0;
  let x1 = bx1;
  const curl = 6;
  for (let y = by0; y <= by1; y++) {
    for (const x of [bx0, bx1]) {
      if (!map.rule[y * map.w + x] || !tail(x, y)) continue;
      const { left, right } = run(x, y);
      if (left < bx0) x0 = Math.max(0, Math.min(x0, left - curl));
      if (right > bx1) x1 = Math.min(map.w - 1, Math.max(x1, right + curl));
    }
  }
  // Maske, soluk halenin büyüyebileceği kadar geniş tutulur; mürekkep kararı
  // yine kutunun içinde verilir.
  const inner = { x0, y0: by0, x1, y1: by1 };
  x0 = Math.max(0, x0 - HALO_RINGS);
  x1 = Math.min(map.w - 1, x1 + HALO_RINGS);
  const y0 = Math.max(0, by0 - HALO_RINGS);
  const y1 = Math.min(map.h - 1, by1 + HALO_RINGS);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const kept = (x: number, y: number) =>
    options.protect.some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);
  // Düz çizgi: basılı imza çizgisi siyah ve uzundur, kalır. Mavi imzada
  // çizginin üstüne düşen renkli kuyruk, siyah imzada kısa düz parça silinir.
  // Mavi imzanın altındaki basılı çizgi hafif mavimsi okunur ama koyudur;
  // imzanın kendisi parlak mavidir. Mavi imzanın geçtiği yerde çizginin
  // pikselleri mavimsi okunur; silinince çizgi kesik kesik kalıyordu (NJ
  // mektubu 1. sayfa). Uzun (basılı) bir çizginin koyu pikseli her renkte kalır.
  const modeled = options.modeled ?? (() => false);
  const keepRule = (x: number, y: number, chroma: number, lum: number) =>
    !modeled(x, y) &&
    (options.colored ? chroma < 30 || (lum < 120 && chroma < 80) || (lum < 170 && !tail(x, y)) : !tail(x, y));
  // Renkli imzada koyu ve renksiz piksel basılı mürekkeptir (siyah yazı, çizgi).
  const darkNeutral = (chroma: number, lum: number) => chroma < 25 && lum < 140;
  const allowed = (x: number, y: number) => {
    const index = y * map.w + x;
    const r = raster.rgb[index * 3];
    const g = raster.rgb[index * 3 + 1];
    const b = raster.rgb[index * 3 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    // Korunan satırın içinde yalnızca imzanın kendi çizgisi (bölgenin
    // mürekkep parçaları) silinir; satırın imzaya değmeyen harfleri kalır.
    // Satırın tamamı korununca imzanın satırı kesen kısmı sayfada kalıyordu
    // ("Sincerely" ve "Jill Holihan" üstündeki çizgiler, NJ mektubu 3. sayfa).
    if (kept(x, y)) return !options.colored && map.mark[index] === 1 && lum < 215;
    // İmza bölgesine katılmış düz parça (renkli kuyruk) çizgi sayılmaz.
    if (map.rule[index] && !map.mark[index] && keepRule(x, y, chroma, lum)) return false;
    if (options.colored) return chroma > 18 && lum < 245;
    if (options.speckled && !map.mark[index]) return false;
    return lum < 215;
  };

  const raw = new Uint8Array(bw * bh);
  for (let y = inner.y0; y <= inner.y1; y++) {
    for (let x = inner.x0; x <= inner.x1; x++) if (allowed(x, y)) raw[(y - y0) * bw + (x - x0)] = 1;
  }
  // Genişletilir (yumuşak kenar), korunan piksele ve basılı çizgiye taşmadan.
  const reach = 2;
  const bits = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (raw[y * bw + x]) {
        bits[y * bw + x] = 1;
        continue;
      }
      const index = (y + y0) * map.w + (x + x0);
      if (kept(x + x0, y + y0)) continue;
      const r = raster.rgb[index * 3];
      const g = raster.rgb[index * 3 + 1];
      const b = raster.rgb[index * 3 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (map.rule[index] && !map.mark[index] && keepRule(x + x0, y + y0, chroma, lum)) continue;
      if (options.colored && darkNeutral(chroma, lum)) continue;
      let near = false;
      for (let dy = -reach; dy <= reach && !near; dy++) {
        for (let dx = -reach; dx <= reach && !near; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < bh && xx >= 0 && xx < bw && raw[yy * bw + xx]) near = true;
        }
      }
      if (near) bits[y * bw + x] = 1;
    }
  }

  // Hale: taramanın bulanıklığı ve JPEG izi çizginin çevresinde birkaç hücre
  // sürer; kağıttan hafifçe koyu bu soluk halka silinmeyince imza gri bir
  // hayalet olarak geri çıkıyordu (NJ mektubu: maskenin 1–3 hücre dışında
  // kağıttan 10–25 düzey koyu yüzlerce piksel). Maske, kağıttan belirgin koyu
  // ama mürekkep sayılmayacak kadar açık komşulara doğru birkaç halka büyür;
  // mürekkebin kendisine (yanındaki harf, çizgi) hiç girmez.
  const paperLum = (() => {
    const values: number[] = [];
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const index = y * map.w + x;
        if (map.ink[index] || bits[(y - y0) * bw + (x - x0)]) continue;
        values.push(0.299 * raster.rgb[index * 3] + 0.587 * raster.rgb[index * 3 + 1] + 0.114 * raster.rgb[index * 3 + 2]);
      }
    }
    if (!values.length) return 255;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  })();
  const faint = (x: number, y: number) => {
    const index = (y + y0) * map.w + (x + x0);
    if (kept(x + x0, y + y0)) return false;
    const r = raster.rgb[index * 3];
    const g = raster.rgb[index * 3 + 1];
    const b = raster.rgb[index * 3 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (!map.ink[index]) return lum < paperLum - HALO_DEPTH;
    // Renkli imzanın kutudan taşan açık renkli kenarı mürekkep sayılır; o da
    // alınır. Taramada mavi imzanın bir kısmı renksiz gri okunur (NJ mektubu:
    // mavi çizginin yanında parlaklığı 150–210, rengi ≈ 0 pikseller); basılı
    // yazının koyu çekirdeği değilse o da imzanındır.
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (map.rule[index] && !map.mark[index] && keepRule(x + x0, y + y0, chroma, lum)) return false;
    return options.colored && lum < 245 && !darkNeutral(chroma, lum) && (chroma > 18 || lum >= 140);
  };
  for (let ring = 0; ring < HALO_RINGS; ring++) {
    const add: number[] = [];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (bits[y * bw + x]) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1 && !touches; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < bh && xx >= 0 && xx < bw && bits[yy * bw + xx]) touches = true;
          }
        }
        if (touches && faint(x, y)) add.push(y * bw + x);
      }
    }
    if (!add.length) break;
    for (const bit of add) bits[bit] = 1;
  }
  return { box: { x0, y0, x1, y1 }, bits };
}

/**
 * Bir satırın mürekkebinin ne kadarı imzaya ait: mavi imzada renkli pikseller,
 * siyah imzada imza bölgesinin içindeki pikseller. Oran yüksekse OCR imzayı
 * yazı sanıp okumuştur ("Jill Hollman"); imzanın üstünden geçtiği basılı
 * isimde oran düşüktür.
 */
export function signatureShare(
  raster: Raster,
  map: InkMap,
  rect: PixelBox,
  mark: { colored: boolean; box: PixelBox },
): number {
  let ink = 0;
  let owned = 0;
  for (let y = Math.max(0, Math.floor(rect.y0)); y <= Math.min(map.h - 1, Math.ceil(rect.y1)); y++) {
    for (let x = Math.max(0, Math.floor(rect.x0)); x <= Math.min(map.w - 1, Math.ceil(rect.x1)); x++) {
      const index = y * map.w + x;
      if (!map.ink[index] || map.rule[index]) continue;
      ink++;
      if (mark.colored) {
        const r = raster.rgb[index * 3];
        const g = raster.rgb[index * 3 + 1];
        const b = raster.rgb[index * 3 + 2];
        if (tinted(Math.max(r, g, b) - Math.min(r, g, b), 0.299 * r + 0.587 * g + 0.114 * b)) owned++;
      } else if (x >= mark.box.x0 && x <= mark.box.x1 && y >= mark.box.y0 && y <= mark.box.y1) {
        owned++;
      }
    }
  }
  return ink ? owned / ink : 0;
}

/**
 * Dikdörtgendeki mürekkebin ne kadarı işaret (imza/mühür) mürekkebi. Bir
 * satır çoğunlukla işaret mürekkebiyse OCR imzayı yazı sanıp okumuştur;
 * imzanın üstünden geçtiği basılı isimde oran düşüktür.
 */
export function inkShare(map: InkMap, rect: { x0: number; y0: number; x1: number; y1: number }): number {
  let ink = 0;
  let marked = 0;
  for (let y = Math.max(0, Math.floor(rect.y0)); y <= Math.min(map.h - 1, Math.ceil(rect.y1)); y++) {
    for (let x = Math.max(0, Math.floor(rect.x0)); x <= Math.min(map.w - 1, Math.ceil(rect.x1)); x++) {
      const index = y * map.w + x;
      if (!map.ink[index]) continue;
      ink++;
      if (map.mark[index]) marked++;
    }
  }
  return ink ? marked / ink : 0;
}

/**
 * Silme maskesinin çevresinde kalan kırıntılar: imzanın ana kümesine bağlı
 * olmayan "i" noktası, kopuk darbe ucu, telefon fotoğrafındaki soluk leke
 * (Mfg mektubu: silinen imzanın çevresinde onlarca nokta kalıyordu). Maske
 * `reach` piksel genişletilip taranır; hiçbir basılı satıra (`protect`) ve
 * düz çizgiye ait olmayan mürekkep parçası küçükse (`maxPiece` piksel) ya da
 * renkli işarette işaretin tonundaysa maskeye eklenir.
 */
export function sweepResidue(
  raster: Raster,
  map: InkMap,
  mask: { box: PixelBox; bits: Uint8Array },
  options: {
    reach: number;
    protect: PixelBox[];
    maxPiece: number;
    colored: boolean;
    /**
     * İşaretin kendi bölgesi: sınıflandırıcı orayı imza/mühür dedi; içindeki
     * korunmayan her parça (telefon fotoğrafında renksiz okunan lacivert
     * darbe de) işaretindir, boyuna ve tonuna bakılmaz.
     */
    inner?: PixelBox;
    /**
     * Sayfanın kağıdı noktacıklı (JBIG2 taraması): küçük parçalar kağıdın
     * dokusudur, süpürülmez; yalnızca işaretin tonundakiler ve büyükler alınır.
     * Süpürülünce imzanın yeri noktasız, açık bir dikdörtgen kalıyordu.
     */
    speckled?: boolean;
  },
): { box: PixelBox; bits: Uint8Array } {
  const old = mask.box;
  const ow = old.x1 - old.x0 + 1;
  const box = {
    x0: Math.max(0, old.x0 - options.reach),
    y0: Math.max(0, old.y0 - options.reach),
    x1: Math.min(map.w - 1, old.x1 + options.reach),
    y1: Math.min(map.h - 1, old.y1 + options.reach),
  };
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const bits = new Uint8Array(bw * bh);
  // İşaretin tonu: maskedeki renkli mürekkebin ortalaması.
  let r = 0;
  let g = 0;
  let b = 0;
  let colored = 0;
  for (let y = old.y0; y <= old.y1; y++) {
    for (let x = old.x0; x <= old.x1; x++) {
      if (!mask.bits[(y - old.y0) * ow + (x - old.x0)]) continue;
      bits[(y - box.y0) * bw + (x - box.x0)] = 1;
      const i = y * map.w + x;
      const [pr, pg, pb] = [raster.rgb[i * 3], raster.rgb[i * 3 + 1], raster.rgb[i * 3 + 2]];
      if (map.ink[i] && tinted(Math.max(pr, pg, pb) - Math.min(pr, pg, pb), 0.299 * pr + 0.587 * pg + 0.114 * pb)) {
        r += pr;
        g += pg;
        b += pb;
        colored++;
      }
    }
  }
  const hue = colored ? hueOf(r / colored, g / colored, b / colored) : null;
  const kept = (x: number, y: number) => options.protect.some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);

  const seen = new Uint8Array(bw * bh);
  for (let y0 = 0; y0 < bh; y0++) {
    for (let x0 = 0; x0 < bw; x0++) {
      const start = y0 * bw + x0;
      const at = (y0 + box.y0) * map.w + (x0 + box.x0);
      if (seen[start] || bits[start] || !map.ink[at] || map.rule[at] || kept(x0 + box.x0, y0 + box.y0)) continue;
      // Parça: maskede olmayan, korunmayan, çizgi olmayan bitişik mürekkep.
      const piece: number[] = [];
      let touchesKept = false;
      let pr = 0;
      let pg = 0;
      let pb = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const local = stack.pop()!;
        piece.push(local);
        const lx = local % bw;
        const ly = (local - lx) / bw;
        const i = (ly + box.y0) * map.w + (lx + box.x0);
        pr += raster.rgb[i * 3];
        pg += raster.rgb[i * 3 + 1];
        pb += raster.rgb[i * 3 + 2];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = lx + dx;
            const ny = ly + dy;
            if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
            const next = ny * bw + nx;
            const j = (ny + box.y0) * map.w + (nx + box.x0);
            if (seen[next] || bits[next] || !map.ink[j] || map.rule[j]) continue;
            if (kept(nx + box.x0, ny + box.y0)) {
              touchesKept = true;
              continue;
            }
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
      if (touchesKept) continue;
      const n = piece.length;
      const cr = pr / n;
      const cg = pg / n;
      const cb = pb / n;
      const sameTone =
        options.colored &&
        hue !== null &&
        tinted(Math.max(cr, cg, cb) - Math.min(cr, cg, cb), 0.299 * cr + 0.587 * cg + 0.114 * cb) &&
        hueGap(hueOf(cr, cg, cb), hue) <= HUE_SPLIT;
      const within =
        options.inner !== undefined &&
        piece.filter((local) => {
          const lx = (local % bw) + box.x0;
          const ly = Math.floor(local / bw) + box.y0;
          return lx >= options.inner!.x0 && lx <= options.inner!.x1 && ly >= options.inner!.y0 && ly <= options.inner!.y1;
        }).length *
          2 >=
          n;
      const small = n <= options.maxPiece;
      if (options.speckled ? !sameTone && !(within && !small) : !small && !sameTone && !within) continue;
      // Parça ve yumuşak kenarı (bir piksel).
      for (const local of piece) {
        const lx = local % bw;
        const ly = (local - lx) / bw;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = lx + dx;
            const ny = ly + dy;
            if (nx < 0 || ny < 0 || nx >= bw || ny >= bh || kept(nx + box.x0, ny + box.y0)) continue;
            if (map.rule[(ny + box.y0) * map.w + (nx + box.x0)]) continue;
            bits[ny * bw + nx] = 1;
          }
        }
      }
    }
  }
  return { box, bits };
}

/**
 * Sayfanın kağıdı noktacıklı mı: küçük, yalnız mürekkep lekelerinin payı
 * (5×5 hücrelik penceresinde en çok dört mürekkep hücresi olan hücre). Siyah-
 * beyaz (JBIG2) taramalarda kağıt ince noktacıklarla doludur. Mürekkep rasteri
 * en koyuyu aldığından hücre sınırına düşen noktacık iki hücrede görünür;
 * "komşusuz hücre" ölçüsü onları kaçırıyordu.
 */
export function speckledPaper(map: InkMap): boolean {
  let specks = 0;
  let cells = 0;
  for (let y = 2; y < map.h - 2; y += 2) {
    for (let x = 2; x < map.w - 2; x += 2) {
      cells++;
      if (!map.ink[y * map.w + x]) continue;
      let around = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) if (map.ink[(y + dy) * map.w + x + dx]) around++;
      }
      if (around <= 4) specks++;
    }
  }
  return cells > 0 && specks / cells > 0.002;
}
