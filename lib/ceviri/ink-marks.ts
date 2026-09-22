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

type Component = { x0: number; y0: number; x1: number; y1: number; n: number; chroma: number };

export function findInkRegions(raster: Raster, pixelsPerPoint: number): InkMap {
  const { w, h, rgb } = raster;
  const ink = new Uint8Array(w * h);
  const chromaAt = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    chromaAt[i] = chroma;
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

  const labels = new Int32Array(w * h).fill(-1);
  const comps: Component[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!strokes[i] || labels[i] >= 0) continue;
    const c: Component = { x0: w, y0: h, x1: 0, y1: 0, n: 0, chroma: 0 };
    labels[i] = comps.length;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      c.n++;
      c.chroma += chromaAt[j];
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
          if (strokes[k] && labels[k] < 0) {
            labels[k] = comps.length;
            stack.push(k);
          }
        }
      }
    }
    c.chroma /= c.n;
    comps.push(c);
  }

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
    if (c.chroma > 45 && c.n >= 20) return true;
    return ch > glyph * 1.9 || cw > glyph * 8;
  });

  type Group = { x0: number; y0: number; x1: number; y1: number; n: number; members: number[] };
  const groups: Group[] = [];
  comps.forEach((c, index) => {
    if (candidate[index]) groups.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, n: c.n, members: [index] });
  });
  // Renkli mürekkep neredeyse hiç basılı yazı değildir: aynı imzanın kopuk
  // kuyruğu daha uzaktan da aynı bölgeye katılır.
  const isColored = (group: { members: number[] }) => group.members.some((index) => comps[index].chroma > 45);
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const r = groups[a];
        const s = groups[b];
        const both = isColored(r) && isColored(s);
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
          };
          groups.splice(b, 1);
          merged = true;
          break outer;
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
    const raw = new Uint8Array(gw * gh);
    let colored = 0;
    let total = 0;
    for (let y = group.y0; y <= group.y1; y++) {
      for (let x = group.x0; x <= group.x1; x++) {
        const index = y * w + x;
        if (labels[index] >= 0 && members.has(labels[index])) {
          raw[(y - group.y0) * gw + (x - group.x0)] = 1;
          mark[index] = 1;
          total++;
          if (chromaAt[index] > 35) colored++;
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
 *  - düz çizgiler (imza çizgisi, tablo),
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
  const y0 = by0;
  const y1 = by1;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const kept = (x: number, y: number) =>
    options.protect.some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);
  // Düz çizgi: basılı imza çizgisi siyah ve uzundur, kalır. Mavi imzada
  // çizginin üstüne düşen renkli kuyruk, siyah imzada kısa düz parça silinir.
  // Mavi imzanın altındaki basılı çizgi hafif mavimsi okunur ama koyudur;
  // imzanın kendisi parlak mavidir.
  const keepRule = (x: number, y: number, chroma: number, lum: number) =>
    options.colored ? chroma < 30 || (lum < 120 && chroma < 80) : !tail(x, y);
  const allowed = (x: number, y: number) => {
    const index = y * map.w + x;
    if (kept(x, y)) return false;
    const r = raster.rgb[index * 3];
    const g = raster.rgb[index * 3 + 1];
    const b = raster.rgb[index * 3 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (map.rule[index] && keepRule(x, y, chroma, lum)) return false;
    if (options.colored) return chroma > 18 && lum < 245;
    return lum < 215;
  };

  const raw = new Uint8Array(bw * bh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (allowed(x, y)) raw[(y - y0) * bw + (x - x0)] = 1;
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
      if (map.rule[index] && keepRule(x + x0, y + y0, chroma, lum)) continue;
      if (options.colored && chroma < 25 && lum < 140) continue;
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
        if (Math.max(r, g, b) - Math.min(r, g, b) > 35) owned++;
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
