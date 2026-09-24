import { test } from "node:test";
import assert from "node:assert/strict";
import { dilate, donorFill, fillErased } from "../lib/ceviri/inpaint.ts";

type Color = [number, number, number];

test("the fill never copies from the erased area itself: a stamp's faint halo does not come back", () => {
  // DELAN SC garanti mektubu: mührün açık mavi-gri kenarı kağıt tonuna yakın;
  // silinen alanın içinden örnek alınınca mührün halkası soluk olarak geri geliyordu.
  const size = 60;
  const paper: Color = [240, 240, 240];
  const halo: Color = [229, 231, 236];
  const inside = (x: number, y: number) => x >= 10 && y >= 10 && x < 50 && y < 50;
  const ring = (x: number, y: number) => Math.abs(Math.hypot(x - 30, y - 30) - 12) < 1.5;
  const patch = new Uint8Array(size * size * 3).fill(240); // yeniden kurulan kağıt
  const sample = (x: number, y: number): Color | null =>
    x < 0 || y < 0 || x >= size || y >= size ? null : ring(x, y) ? halo : paper;

  donorFill(patch, size, size, sample, inside, { radius: 25, seed: 7, paper });

  let ghost = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue;
      const at = (y * size + x) * 3;
      if (patch[at] < 236) ghost++;
    }
  }
  assert.equal(ghost, 0, `${ghost} pixels of the erased halo were copied back`);
});

/**
 * NJ mektubu 1. sayfa (temiz renkli tarama): silinen imzanın yerinde gri
 * lekeler ve siyah noktacıklar imzanın şeklini çiziyordu. Ton ve bağışçı,
 * imzanın hemen yanındaki soluk haleden alınıyordu; imzanın maskeye girmeyen
 * küçük parçaları da "noktacık" sayılıp içeri kopyalanıyordu.
 */
test("an erased signature on clean paper is filled with the paper, not with its halo or its own crumbs", () => {
  const width = 120;
  const height = 60;
  const paper: Color = [252, 252, 252];
  const stroke = (x: number, y: number) => Math.abs(y - (30 + 10 * Math.sin(x / 9))) <= 1.5 && x >= 10 && x < 110;
  const masked = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (stroke(x, y)) masked[y * width + x] = 1;
  const distance = (x: number, y: number) => {
    let best = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height && masked[yy * width + xx]) best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  };
  // Hale: darbenin 1–4 piksel yanı, kağıttan 8 düzey koyu. Kırıntı: darbeden
  // iki yanında 9 piksel uzakta, maskeye girmemiş tek piksellik koyu parçalar.
  const crumbs = new Set<number>();
  for (let x = 12; x < 110; x += 4) {
    const center = Math.round(30 + 10 * Math.sin(x / 9));
    for (const y of [center - 9, center + 9]) if (y >= 0 && y < height) crumbs.add(y * width + x);
  }
  const sample = (x: number, y: number): Color | null => {
    if (x < -20 || y < -20 || x >= width + 20 || y >= height + 20) return null;
    if (x >= 0 && y >= 0 && x < width && y < height) {
      if (masked[y * width + x]) return [40, 60, 150];
      if (crumbs.has(y * width + x)) return [52, 52, 58];
      const d = distance(x, y);
      if (d <= 4) return [243, 244, 247];
    }
    return paper;
  };
  const patch = fillErased(sample, width, height, masked, { margin: 8, seed: 3, paper, radius: 12, halo: 5 });

  let sum = 0;
  let count = 0;
  let dark = 0;
  for (let i = 0; i < width * height; i++) {
    if (!masked[i]) continue;
    const lum = 0.299 * patch[i * 3] + 0.587 * patch[i * 3 + 1] + 0.114 * patch[i * 3 + 2];
    sum += lum;
    count++;
    if (lum < 200) dark++;
  }
  assert.ok(sum / count >= 250, `fill averages ${(sum / count).toFixed(1)}, the paper is 252`);
  assert.equal(dark, 0, `${dark} dark crumbs were copied into the erased stroke`);
});

test("dilate grows a mask by the given number of pixels", () => {
  const mask = new Uint8Array(25);
  mask[12] = 1; // 5×5'in ortası
  const grown = dilate(mask, 5, 5, 1);
  assert.equal(grown.reduce((sum, bit) => sum + bit, 0), 9);
  assert.equal(dilate(mask, 5, 5, 2).reduce((sum, bit) => sum + bit, 0), 25);
});

test("an erased signature between two printed lines is not textured with the lines' halo", () => {
  // NJ mektubu 1. sayfa: imza maskesinin dikdörtgeni "Sincerely," ile basılı
  // ismin arasından geçer; dolgunun dokusu o satırlardan alınınca silinen
  // imzanın yeri gri lekelerle imzanın şeklini çiziyordu.
  const width = 120;
  const height = 60;
  const paper: Color = [254, 254, 254];
  const masked = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (Math.abs(y - (30 + 12 * Math.sin(x / 8))) <= 2 && x >= 8 && x < 112) masked[y * width + x] = 1;
  const printed = (x: number): Color => {
    const k = ((x % 6) + 6) % 6;
    return k < 2 ? [30, 30, 30] : k === 2 || k === 5 ? [226, 226, 226] : [246, 246, 246];
  };
  const sample = (x: number, y: number): Color | null => {
    if (x < -20 || y < -20 || x >= width + 20 || y >= height + 20) return null;
    if ((y < 0 && y >= -8) || (y >= height && y < height + 8)) return printed(x);
    if (x >= 0 && y >= 0 && x < width && y < height && masked[y * width + x]) return [40, 60, 150];
    return paper;
  };
  const patch = fillErased(sample, width, height, masked, { margin: 8, seed: 3, paper, radius: 16, halo: 5 });
  let low = 254;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    if (!masked[i]) continue;
    const lum = 0.299 * patch[i * 3] + 0.587 * patch[i * 3 + 1] + 0.114 * patch[i * 3 + 2];
    low = Math.min(low, lum);
    sum += lum;
    count++;
  }
  assert.ok(sum / count >= 252, `fill averages ${(sum / count).toFixed(1)} on paper of 254`);
  assert.ok(low >= 246, `the fill has a blotch of ${low.toFixed(0)} on paper of 254`);
});

test("the fill does not carry the faint grey haze left around dense ink onto white paper", () => {
  // NJ mektubu 3. sayfa: siyah imzanın ve yazının 1-3 punto çevresinde JPEG'in
  // soluk grisi (kağıttan 8-12 düzey koyu) kalıyor; dolgu onu kağıt sanıp
  // taşıyınca silinen imzanın yeri imzanın şeklinde açık gri lekelendi.
  const width = 120;
  const height = 60;
  const paper: Color = [255, 255, 255];
  const masked = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (Math.abs(y - (30 + 12 * Math.sin(x / 8))) <= 2 && x >= 8 && x < 112) masked[y * width + x] = 1;
  const distance = (x: number, y: number) => {
    let best = Infinity;
    for (let dy = -12; dy <= 12; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -12; dx <= 12; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < width && masked[yy * width + xx]) best = Math.min(best, Math.hypot(dx, dy));
      }
    }
    return best;
  };
  const sample = (x: number, y: number): Color | null => {
    if (x < -20 || y < -20 || x >= width + 20 || y >= height + 20) return null;
    if (x >= 0 && y >= 0 && x < width && y < height) {
      if (masked[y * width + x]) return [30, 30, 30];
      const d = distance(x, y);
      // 5-12 piksel ötede hafif gri pus, kağıttan 9 düzey koyu.
      if (d <= 12) return [246, 246, 246];
    }
    return paper;
  };
  const patch = fillErased(sample, width, height, masked, { margin: 8, seed: 3, paper, radius: 16, halo: 5 });
  let hazy = 0;
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    if (!masked[i]) continue;
    count++;
    const lum = 0.299 * patch[i * 3] + 0.587 * patch[i * 3 + 1] + 0.114 * patch[i * 3 + 2];
    if (lum < 250) hazy++;
  }
  assert.ok(hazy / count < 0.05, `${((100 * hazy) / count).toFixed(1)}% of the fill took the grey haze`);
});
