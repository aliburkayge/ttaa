import { tinted, type Raster } from "./ink-marks";
import { findRules, ruleAt, type RuleLine } from "./rules";

/**
 * Çıktı PDF'inin kalite ölçeri: orijinal sayfa ile çevrilmiş sayfa aynı
 * ölçekte çizilir (geometri aynıdır, hizalama gerekmez) ve beş kusur türü
 * sayılır. Her iyileştirme bu sayılarla ölçülür.
 *
 *  - rule    : orijinaldeki düz çizgi çıktıda kesik (imzanın geçtiği yer silinmiş).
 *  - text    : dokunulmaması gereken basılı yazı bozulmuş ya da düzenleme alanı
 *              dışında bir şey değişmiş.
 *  - residue : imza/mühür alanında silinmeden kalan mürekkep (kırıntı, nokta).
 *  - patch   : silinen yerin dolgusu çevresindeki kağıttan belirgin açık/koyu ya
 *              da dokusuz (leke, hayalet).
 *  - label   : [İMZA]/[MÜHÜR] etiketi bir çizginin, kalıntının ya da yazının üstünde.
 */

export type PixelBox = { x0: number; y0: number; x1: number; y1: number };

export type AuditZones = {
  /** İmza/mühür alanları. */
  marks: Array<{ box: PixelBox; kind: string }>;
  /** Çizilen etiketlerin kutuları. */
  labels: PixelBox[];
  /** Yerinde kalan basılı satırlar: pikselleri değişmemeli. */
  protect: PixelBox[];
  /** İşaretlerin silme yamaları (alanın dışına taşan kuyruk dahil). */
  markPatches: PixelBox[];
  /** Yeniden yazılan satırların silme yamaları. */
  editable: PixelBox[];
  /** Çizgisi bilerek silinebilen yerler (çeviriyle yeniden çizilen alt çizgi). */
  exempt: PixelBox[];
  /** Yeni yazının çizildiği kutular. */
  drawn: PixelBox[];
};

export type Defect = {
  kind: "rule" | "text" | "residue" | "patch" | "label";
  box: PixelBox;
  /** Büyüklük: rule → eksik punto, residue/text → punto², patch → parlaklık farkı. */
  amount: number;
  note: string;
};

export const AUDIT = {
  /** Çizginin çıktıda mürekkepli oranı bundan azsa kesiktir. */
  ruleCoverage: 0.97,
  /** Sayılan en kısa kopukluk (punto). */
  minGap: 1,
  /** Kalıntı: en küçük parça (piksel) ve rapor eşiği (piksel toplamı). */
  residuePiece: 2,
  residueReport: 6,
  /** Dolgu: çevreden parlaklık farkı ve doku (σ) oranı sınırları. */
  patchMean: 6,
  patchTextureLow: 0.45,
  patchTextureHigh: 2.2,
  /** Bozulan yazı ya da alan dışı değişiklik: rapor eşiği (piksel). */
  damage: 8,
  /** Hayalet: en az bu kadar piksel ve dolgunun bu payı. */
  ghostPixels: 30,
  ghostShare: 0.02,
};

type Plane = { lum: Float32Array; chroma: Uint8Array; paper: number };

function plane(raster: Raster): Plane {
  const { w, h, rgb } = raster;
  const lum = new Float32Array(w * h);
  const chroma = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    chroma[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const sample: number[] = [];
  for (let i = 0; i < w * h; i += 7) sample.push(lum[i]);
  sample.sort((a, b) => a - b);
  return { lum, chroma, paper: sample[Math.floor(sample.length * 0.6)] ?? 255 };
}

const inside = (box: PixelBox, x: number, y: number) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
const grow = (box: PixelBox, d: number): PixelBox => ({ x0: box.x0 - d, y0: box.y0 - d, x1: box.x1 + d, y1: box.y1 + d });
const intersects = (a: PixelBox, b: PixelBox) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** 8-komşulu bağlı bileşenler: her biri piksel sayısı ve kutusu. */
function pieces(set: Uint8Array, w: number, h: number, box: PixelBox): Array<{ n: number; box: PixelBox; pixels: number[] }> {
  const seen = new Uint8Array(set.length);
  const out: Array<{ n: number; box: PixelBox; pixels: number[] }> = [];
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(w - 1, Math.ceil(box.x1));
  const y1 = Math.min(h - 1, Math.ceil(box.y1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const start = y * w + x;
      if (!set[start] || seen[start]) continue;
      const pixels: number[] = [];
      const stack = [start];
      seen[start] = 1;
      const b = { x0: x, y0: y, x1: x, y1: y };
      while (stack.length) {
        const index = stack.pop()!;
        pixels.push(index);
        const px = index % w;
        const py = (index - px) / w;
        b.x0 = Math.min(b.x0, px);
        b.x1 = Math.max(b.x1, px);
        b.y0 = Math.min(b.y0, py);
        b.y1 = Math.max(b.y1, py);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
            const next = ny * w + nx;
            if (set[next] && !seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
          }
        }
      }
      out.push({ n: pixels.length, box: b, pixels });
    }
  }
  return out;
}

function stats(values: number[]): { mean: number; std: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

/**
 * Bir sayfanın kusurları. `before` orijinal, `after` çıktı; ikisi aynı
 * boyutta. `rules` verilmezse orijinalden bulunur.
 */
export function auditPage(
  before: Raster,
  after: Raster,
  pixelsPerPoint: number,
  zones: AuditZones,
  options: { rules?: RuleLine[]; limits?: typeof AUDIT } = {},
): Defect[] {
  const limits = options.limits ?? AUDIT;
  const { w, h } = before;
  const B = plane(before);
  const A = plane(after);
  const inkA = (i: number) => A.lum[i] < A.paper - 60 || (tinted(A.chroma[i], A.lum[i]) && A.lum[i] < A.paper - 20);
  const inkB = (i: number) => B.lum[i] < B.paper - 60 || (tinted(B.chroma[i], B.lum[i]) && B.lum[i] < B.paper - 20);
  const pt = pixelsPerPoint;
  const defects: Defect[] = [];

  // Çizgi bantları: kalıntı ve etiket ölçümünde çizginin kendisi sayılmaz.
  const rules = options.rules ?? findRules(before, pixelsPerPoint);
  const band = new Uint8Array(w * h);
  const bandBoxes: PixelBox[] = [];
  for (const rule of rules) {
    const half = rule.thickness / 2 + 2;
    for (let along = Math.max(0, Math.floor(rule.start)); along <= Math.ceil(rule.end); along++) {
      const center = ruleAt(rule, along);
      for (let cross = Math.floor(center - half); cross <= Math.ceil(center + half); cross++) {
        const [x, y] = rule.orientation === "h" ? [along, cross] : [cross, along];
        if (x >= 0 && y >= 0 && x < w && y < h) band[y * w + x] = 1;
      }
    }
    const a0 = ruleAt(rule, rule.start);
    const a1 = ruleAt(rule, rule.end);
    bandBoxes.push(
      rule.orientation === "h"
        ? { x0: rule.start, y0: Math.min(a0, a1) - half, x1: rule.end, y1: Math.max(a0, a1) + half }
        : { x0: Math.min(a0, a1) - half, y0: rule.start, x1: Math.max(a0, a1) + half, y1: rule.end },
    );
  }

  // --- rule: çizginin sürekliliği ---
  const dark = Math.min(170, A.paper - 50);
  for (const rule of rules) {
    // Tamamen tek bir çevrilen satırın yamasında kalan çizgi o satırın alt
    // çizgisidir (köprü): satırla birlikte kalkar. Satırın dışına uzanan tablo
    // kenarı denetlenir.
    const r0 = ruleAt(rule, rule.start);
    const r1 = ruleAt(rule, rule.end);
    const own = zones.editable.some((box) =>
      rule.orientation === "h"
        ? rule.start >= box.x0 - 3 * pt && rule.end <= box.x1 + 3 * pt && Math.min(r0, r1) >= box.y0 - pt && Math.max(r0, r1) <= box.y1 + pt
        : rule.start >= box.y0 - 3 * pt && rule.end <= box.y1 + 3 * pt && Math.min(r0, r1) >= box.x0 - pt && Math.max(r0, r1) <= box.x1 + pt,
    );
    if (own) continue;
    const half = rule.thickness / 2 + 1;
    let total = 0;
    let missing = 0;
    let gapStart = -1;
    let first: number | null = null;
    let last: number | null = null;
    const closeGap = (end: number) => {
      if (gapStart >= 0 && end - gapStart >= limits.minGap * pt) {
        missing += end - gapStart;
        first = first ?? gapStart;
        last = end;
      }
      gapStart = -1;
    };
    for (let along = Math.max(0, Math.floor(rule.start)); along <= Math.ceil(rule.end); along++) {
      const center = ruleAt(rule, along);
      const at = (cross: number) => (rule.orientation === "h" ? [along, cross] : [cross, along]);
      const [cx, cy] = at(Math.round(center));
      if (zones.exempt.some((box) => inside(box, cx, cy))) {
        closeGap(along);
        continue;
      }
      total++;
      let covered = false;
      for (let cross = Math.floor(center - half); cross <= Math.ceil(center + half) && !covered; cross++) {
        const [x, y] = at(cross);
        if (x >= 0 && y >= 0 && x < w && y < h && A.lum[y * w + x] < dark) covered = true;
      }
      if (covered) closeGap(along);
      else if (gapStart < 0) gapStart = along;
    }
    closeGap(Math.ceil(rule.end) + 1);
    if (first === null || last === null || !total || 1 - missing / total >= limits.ruleCoverage) continue;
    const center = ruleAt(rule, (first + last) / 2);
    const half2 = rule.thickness / 2 + 2;
    defects.push({
      kind: "rule",
      box:
        rule.orientation === "h"
          ? { x0: first, y0: center - half2, x1: last, y1: center + half2 }
          : { x0: center - half2, y0: first, x1: center + half2, y1: last },
      amount: missing / pt,
      note: `çizgi ${(missing / pt).toFixed(1)} punto kesik`,
    });
  }

  // --- text: korunan yazının bozulması ve alan dışı değişiklik ---
  // Yeniden yazılan satırın alanı, çakışan korunan alanın önüne geçer; işaret
  // alanı geçmez: imzanın ısırdığı korunan harf tam da aranan kusurdur.
  const rewritten = [...zones.editable, ...zones.drawn].map((box) => grow(box, pt));
  // Renkli mürekkebin (mühür, imza) 2 piksel yakını karışım bölgesidir: orada
  // silinen koyu piksel mührün harfe karışan çekirdeğidir, harf değil.
  const nearTint = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (tinted(B.chroma[j], B.lum[j]) && B.lum[j] < B.paper - 20) return true;
      }
    }
    return false;
  };
  // İşaret alanında korunan satıra değen koyu parça satırın dışına 2 puntodan
  // fazla taşıyorsa siyah imza darbesidir: harf kendi satırında kalır.
  const stroke = new Uint8Array(w * h);
  for (const box of zones.protect) {
    if (!zones.marks.some((mark) => intersects(grow(mark.box, 2 * pt), box))) continue;
    const reach = grow(box, 12 * pt);
    const dark = new Uint8Array(w * h);
    for (let y = Math.max(0, Math.floor(reach.y0)); y <= Math.min(h - 1, Math.ceil(reach.y1)); y++) {
      for (let x = Math.max(0, Math.floor(reach.x0)); x <= Math.min(w - 1, Math.ceil(reach.x1)); x++) {
        const i = y * w + x;
        if (B.lum[i] < B.paper - 70) dark[i] = 1;
      }
    }
    for (const piece of pieces(dark, w, h, reach)) {
      const out = Math.max(box.x0 - piece.box.x0, piece.box.x1 - box.x1, box.y0 - piece.box.y0, piece.box.y1 - box.y1);
      if (out > 2 * pt && intersects(piece.box, box)) for (const i of piece.pixels) stroke[i] = 1;
    }
  }
  const damaged = new Uint8Array(w * h);
  for (const box of zones.protect) {
    for (let y = Math.max(0, Math.floor(box.y0)); y <= Math.min(h - 1, Math.ceil(box.y1)); y++) {
      for (let x = Math.max(0, Math.floor(box.x0)); x <= Math.min(w - 1, Math.ceil(box.x1)); x++) {
        const i = y * w + x;
        // Yalnız basılı (renksiz koyu) mürekkep: silinen mavi imza darbesi bozulma değildir.
        if (B.lum[i] < B.paper - 70 && B.chroma[i] < 30 && A.lum[i] > B.lum[i] + 60 && !rewritten.some((a) => inside(a, x, y)) && !nearTint(x, y) && !stroke[i]) {
          damaged[i] = 1;
        }
      }
    }
  }
  const allowed = [...rewritten, ...[...zones.markPatches, ...zones.marks.map((mark) => mark.box), ...zones.labels].map((box) => grow(box, pt))];
  const everywhere = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (damaged[i] || Math.abs(A.lum[i] - B.lum[i]) <= 45) continue;
      if (zones.protect.some((box) => inside(box, x, y)) || allowed.some((box) => inside(box, x, y))) continue;
      damaged[i] = 1;
    }
  }
  for (const piece of pieces(damaged, w, h, everywhere)) {
    // Bir piksellik şerit, yamayla sayfa görüntüsünün alt-piksel hizası: görünmez.
    // Gerçek delik ya da kesik iki yönde de en az iki pikseldir.
    if (piece.n < limits.damage || Math.min(piece.box.x1 - piece.box.x0, piece.box.y1 - piece.box.y0) < 1) continue;
    const kept = zones.protect.some((box) => intersects(box, piece.box));
    defects.push({
      kind: "text",
      box: piece.box,
      amount: piece.n / (pt * pt),
      note: kept ? "korunan yazı bozuldu" : "düzenleme alanı dışında değişiklik",
    });
  }

  // --- residue ve patch: işaret alanları ---
  const excluded = [...zones.labels.map((box) => grow(box, pt)), ...zones.protect, ...zones.drawn.map((box) => grow(box, 1))];
  const residuePieces: Array<{ n: number; box: PixelBox }> = [];
  for (const mark of zones.marks) {
    const zone = grow(mark.box, 2 * pt);
    const left = new Uint8Array(w * h);
    for (let y = Math.max(0, Math.floor(zone.y0)); y <= Math.min(h - 1, Math.ceil(zone.y1)); y++) {
      for (let x = Math.max(0, Math.floor(zone.x0)); x <= Math.min(w - 1, Math.ceil(zone.x1)); x++) {
        const i = y * w + x;
        if (!inkA(i) || band[i] || excluded.some((box) => inside(box, x, y))) continue;
        left[i] = 1;
      }
    }
    // Noktacıklı kağıtta (çevrede küçük, renksiz nokta sık) küçük renksiz nokta
    // kağıdın kendisidir, kalıntı değil.
    const speck = (piece: { n: number; pixels: number[] }) =>
      piece.n <= 0.5 * pt * pt && !piece.pixels.some((i) => tinted(A.chroma[i], A.lum[i]));
    const ringZone = grow(mark.box, 10 * pt);
    const ringInk = new Uint8Array(w * h);
    for (let y = Math.max(0, Math.floor(ringZone.y0)); y <= Math.min(h - 1, Math.ceil(ringZone.y1)); y++) {
      for (let x = Math.max(0, Math.floor(ringZone.x0)); x <= Math.min(w - 1, Math.ceil(ringZone.x1)); x++) {
        const i = y * w + x;
        if (inside(zone, x, y) || !inkA(i) || band[i] || excluded.some((box) => inside(box, x, y))) continue;
        ringInk[i] = 1;
      }
    }
    const ringArea = ((ringZone.x1 - ringZone.x0) * (ringZone.y1 - ringZone.y0) - (zone.x1 - zone.x0) * (zone.y1 - zone.y0)) / (pt * pt);
    const speckled = pieces(ringInk, w, h, ringZone).filter(speck).length / Math.max(1, ringArea) > 0.005;
    const found = pieces(left, w, h, zone).filter((piece) => piece.n >= limits.residuePiece && !(speckled && speck(piece)));
    const total = found.reduce((sum, piece) => sum + piece.n, 0);
    if (total >= limits.residueReport) {
      const colored = found.filter((piece) => piece.pixels.some((i) => tinted(A.chroma[i], A.lum[i]))).length;
      residuePieces.push(...found);
      defects.push({
        kind: "residue",
        box: found.reduce((box, piece) => ({
          x0: Math.min(box.x0, piece.box.x0),
          y0: Math.min(box.y0, piece.box.y0),
          x1: Math.max(box.x1, piece.box.x1),
          y1: Math.max(box.y1, piece.box.y1),
        }), found[0].box),
        amount: total / (pt * pt),
        note: `${mark.kind}: ${found.length} parça (${colored} renkli), ${(total / (pt * pt)).toFixed(1)} punto²`,
      });
    }

    // Dolgu: işaretten silinen (ya da değiştirilen) kağıt pikselleri ile çevre halkası.
    const filled: number[] = [];
    const ring: number[] = [];
    const outer = grow(mark.box, 8 * pt);
    const innerEdge = grow(mark.box, 2 * pt);
    for (let y = Math.max(0, Math.floor(outer.y0)); y <= Math.min(h - 1, Math.ceil(outer.y1)); y++) {
      for (let x = Math.max(0, Math.floor(outer.x0)); x <= Math.min(w - 1, Math.ceil(outer.x1)); x++) {
        const i = y * w + x;
        if (inkA(i) || band[i] || excluded.some((box) => inside(box, x, y))) continue;
        if (inside(mark.box, x, y)) {
          if (inkB(i) || Math.abs(A.lum[i] - B.lum[i]) > 12) filled.push(A.lum[i]);
        } else if (!inside(innerEdge, x, y) && !inkB(i)) {
          ring.push(A.lum[i]);
        }
      }
    }
    if (filled.length >= 30 && ring.length >= 30) {
      const f = stats(filled);
      const r = stats(ring);
      const shift = f.mean - r.mean;
      const texture = r.std > 0.5 ? f.std / r.std : 1;
      // Hayalet: silinen yerde kağıttan belirgin koyu kalan soluk iz.
      const ghost = filled.filter((value) => value < r.mean - Math.max(10, 2.5 * r.std)).length;
      const reasons: string[] = [];
      if (Math.abs(shift) > limits.patchMean) reasons.push(`dolgu çevreden ${shift > 0 ? "açık" : "koyu"} (${shift.toFixed(1)})`);
      if (texture < limits.patchTextureLow || texture > limits.patchTextureHigh) reasons.push(`doku oranı ${texture.toFixed(2)}`);
      if (ghost >= limits.ghostPixels && ghost >= limits.ghostShare * filled.length) {
        reasons.push(`hayalet ${ghost} piksel (%${((100 * ghost) / filled.length).toFixed(0)})`);
      }
      if (reasons.length) {
        defects.push({ kind: "patch", box: mark.box, amount: Math.max(Math.abs(shift), ghost / (pt * pt)), note: `${mark.kind}: ${reasons.join(", ")}` });
      }
    }
  }

  // --- residue: çevrilen satırın silindiği yerde kalan eski mürekkep ---
  for (const box of zones.editable) {
    const left = new Uint8Array(w * h);
    for (let y = Math.max(0, Math.floor(box.y0)); y <= Math.min(h - 1, Math.ceil(box.y1)); y++) {
      for (let x = Math.max(0, Math.floor(box.x0)); x <= Math.min(w - 1, Math.ceil(box.x1)); x++) {
        const i = y * w + x;
        if (!inkA(i) || !inkB(i) || band[i] || excluded.some((e) => inside(e, x, y))) continue;
        left[i] = 1;
      }
    }
    const found = pieces(left, w, h, box).filter((piece) => piece.n >= limits.residuePiece);
    const total = found.reduce((sum, piece) => sum + piece.n, 0);
    if (total < limits.residueReport) continue;
    defects.push({
      kind: "residue",
      box,
      amount: total / (pt * pt),
      note: `yazı silme kalıntısı: ${found.length} parça, ${(total / (pt * pt)).toFixed(1)} punto²`,
    });
  }

  // --- label: etiketin çakışması ---
  for (const label of zones.labels) {
    const reasons: string[] = [];
    if (bandBoxes.some((box) => intersects(box, label))) reasons.push("çizginin üstünde");
    if (residuePieces.some((piece) => intersects(grow(label, pt), piece.box))) reasons.push("kalıntıya değiyor");
    if (zones.protect.some((box) => intersects(box, label))) reasons.push("yazının üstünde");
    if (reasons.length) defects.push({ kind: "label", box: label, amount: reasons.length, note: `etiket ${reasons.join(", ")}` });
  }
  return defects;
}
