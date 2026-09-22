/**
 * Silinen yazının yerine kağıdı yeniden kurar.
 *
 * Düz tek renkli bir yama beyaz, pürüzsüz bir taramada görünmez; telefonla
 * çekilmiş ya da sararmış bir sayfada ise hemen seçilir: kağıt gridir, ışık
 * sayfa boyunca değişir, kağıdın kendi dokusu ve JPEG gürültüsü vardır. Tek
 * bir "kağıt rengi" bunların hiçbirini taşımaz ve silinen her satır açık renkli
 * bir dikdörtgen olarak kalıyordu.
 *
 * Burada yama, silinen bölgenin hemen çevresindeki gerçek kağıttan kurulur:
 *
 *  1. Dört kenarda (üst, alt, sol, sağ) kenar boyunca kağıt rengi ölçülür.
 *     Her noktada küçük bir penceredeki piksellerin açık olanları alınır;
 *     komşu satırın harfleri, kırıntılar bu yüzden ölçüye girmez.
 *  2. İç kısım dört kenardan Coons yamasıyla (transfinite interpolasyon)
 *     doldurulur: ışığın eğimi ve kağıdın ton değişimi her iki yönde de korunur.
 *  3. Üst ve alt şeritteki kağıdın gerçek dokusu (ölçülen renkten sapması)
 *     yamaya bloklar hâlinde aktarılır; yama çevresi kadar lekeli ve grenli
 *     olur, pürüzsüz bir leke gibi durmaz.
 */

export type Color = [number, number, number];

function luminance(color: Color): number {
  return 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
}

/** Belirlenimci rastgele sayı: aynı belge her indirmede aynı çıktıyı verir. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bir penceredeki kağıdın rengi. Başvuru, piksellerin en açık %30'unun
 * sınırıdır: pencerenin %70'ini harf kaplasa da kağıda düşer. Başvurudan 40
 * düzeyden fazla koyu piksel harf ya da lekedir; geri kalanı kağıttır (gren
 * dahil). Kağıdın rengi bunların kanal kanal ortancasıdır: grenin iki ucu
 * da eşit sayıldığından yama çevresiyle aynı tonda çıkar. Grenin yalnızca
 * koyu ucunu kesmek yamayı 6 düzey açık gösteriyordu. Kağıt yoksa null.
 */
function paperOf(pixels: Color[], floor: number): Color | null {
  if (pixels.length < 3) return null;
  const lums = pixels.map(luminance).sort((a, b) => b - a);
  const reference = lums[Math.floor(lums.length * 0.3)];
  if (reference < floor) return null;
  const paper = pixels.filter((color) => luminance(color) >= reference - 40);
  if (!paper.length) return null;
  return [0, 1, 2].map((channel) => {
    const values = paper.map((color) => color[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  }) as Color;
}

/**
 * Kenar boyunca yumuşatma: önce kayan ortanca (tek tük hatalı ölçüyü atar),
 * sonra kayan ortalama. Işık kenar boyunca yavaş değişir; sütundan sütuna
 * oynama ölçü hatasıdır ve yamada dikey çizgi izi olarak görünüyordu.
 */
function smooth(profile: Array<Color | null>, radius: number): Array<Color | null> {
  const medianed = profile.map((value, index) => {
    if (!value) return null;
    const window: Color[] = [];
    for (let k = Math.max(0, index - radius); k <= Math.min(profile.length - 1, index + radius); k++) {
      const other = profile[k];
      if (other) window.push(other);
    }
    return [0, 1, 2].map((channel) => {
      const values = window.map((color) => color[channel]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    }) as Color;
  });
  const half = Math.max(1, Math.round(radius / 2));
  return medianed.map((value, index) => {
    if (!value) return null;
    const sum = [0, 0, 0];
    let count = 0;
    for (let k = Math.max(0, index - half); k <= Math.min(medianed.length - 1, index + half); k++) {
      const other = medianed[k];
      if (!other) continue;
      for (let i = 0; i < 3; i++) sum[i] += other[i];
      count++;
    }
    return sum.map((total) => total / count) as Color;
  });
}

/** Eksik ölçümleri komşulardan doğrusal olarak doldurur. */
function fillGaps(profile: Array<Color | null>): Array<Color | null> {
  const known = profile.map((value, index) => (value ? index : -1)).filter((index) => index >= 0);
  if (!known.length) return profile;
  return profile.map((value, index) => {
    if (value) return value;
    const before = [...known].reverse().find((k) => k < index);
    const after = known.find((k) => k > index);
    if (before === undefined) return profile[after as number];
    if (after === undefined) return profile[before];
    const t = (index - before) / (after - before);
    const a = profile[before] as Color;
    const b = profile[after] as Color;
    return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Color;
  });
}

/**
 * `width` × `height` piksellik bir yama kurar. `sample(x, y)` yamanın piksel
 * koordinatında (kenar payı için negatif ya da boyuttan büyük de olabilir)
 * sayfanın rengini verir; sayfanın dışıysa null.
 *
 * @returns RGB, satır satır (width × height × 3).
 */
export function reconstructPaper(
  sample: (x: number, y: number) => Color | null,
  width: number,
  height: number,
  options: { margin: number; window?: number; seed?: number; fallback: Color },
): Uint8Array {
  const margin = Math.max(2, Math.round(options.margin));
  const half = Math.max(1, Math.round(options.window ?? 3));
  const cache = new Map<number, Color | null>();
  const at = (x: number, y: number) => {
    const key = (y + margin + 1) * (width + 2 * margin + 4) + x + margin + 1;
    if (!cache.has(key)) cache.set(key, sample(x, y));
    return cache.get(key) ?? null;
  };

  // Çevrenin genel kağıt düzeyi: bir kenar ölçüsü bundan çok koyuysa oradaki
  // şey kağıt değil bir işarettir (imza, fotoğraf) ve ölçü sayılmaz.
  const ring: Color[] = [];
  for (let x = -margin; x < width + margin; x += 2) {
    for (let y = -margin; y < 0; y++) {
      const top = at(x, y);
      const bottom = at(x, height - 1 - y);
      if (top) ring.push(top);
      if (bottom) ring.push(bottom);
    }
  }
  for (let y = 0; y < height; y += 2) {
    for (let x = -margin; x < 0; x++) {
      const left = at(x, y);
      const right = at(width - 1 - x, y);
      if (left) ring.push(left);
      if (right) ring.push(right);
    }
  }
  const general = paperOf(ring, 0) ?? options.fallback;
  // Genel kağıttan belirgin koyu bir kenar ölçüsü kağıt değildir (komşu
  // satırın harfleri pencereyi doldurmuş, ya da bir imza/fotoğraf); atlanır
  // ve komşu ölçülerden doldurulur.
  const floor = luminance(general) - 25;

  const edge = (length: number, pixelsAt: (index: number) => Color[]) => {
    const raw = Array.from({ length }, (_, index) => paperOf(pixelsAt(index), floor));
    return fillGaps(smooth(raw, Math.max(2, Math.min(12, Math.round(length / 4)))));
  };

  const collect = (xs: [number, number], ys: [number, number]) => {
    const pixels: Color[] = [];
    for (let y = ys[0]; y < ys[1]; y++) {
      for (let x = xs[0]; x < xs[1]; x++) {
        const color = at(x, y);
        if (color) pixels.push(color);
      }
    }
    return pixels;
  };
  const top = edge(width, (x) => collect([x - half, x + half + 1], [-margin, 0]));
  const bottom = edge(width, (x) => collect([x - half, x + half + 1], [height, height + margin]));
  const left = edge(height, (y) => collect([-margin, 0], [y - half, y + half + 1]));
  const right = edge(height, (y) => collect([width, width + margin], [y - half, y + half + 1]));

  // Bir kenar tamamen ölçülemediyse karşı kenar, o da yoksa genel kağıt.
  const orFallback = (profile: Array<Color | null>, opposite: Array<Color | null>, index: number): Color =>
    profile[index] ?? opposite[Math.min(index, opposite.length - 1)] ?? general;
  const T = (x: number) => orFallback(top, bottom, x);
  const B = (x: number) => orFallback(bottom, top, x);
  const L = (y: number) => orFallback(left, right, y);
  const R = (y: number) => orFallback(right, left, y);

  // Doku: üst ve alt şeritteki gerçek kağıdın, ölçülen kağıt renginden
  // sapması. Kağıdın dokusu lekelidir (birkaç piksellik açık-koyu bölgeler);
  // piksel piksel rastgele gren onu taşımıyor, yama çevresinden pürüzsüz ve
  // açık görünüyordu. Harf ve leke pikselleri dokuya alınmaz, aynı sıradaki
  // yakın bir kağıt pikseliyle değiştirilir.
  const next = random(options.seed ?? width * 7919 + height);
  const span = width + 2 * margin;
  const strips: Array<Array<Float32Array>> = [[], []]; // [üst, alt] × satır → x·3 + kanal
  for (const [which, reference, rowOf] of [
    [0, T, (k: number) => -margin + k],
    [1, B, (k: number) => height + k],
  ] as const) {
    // Önce şeridin tamamında harf ve leke pikselleri bulunur, sonra çevreleri
    // 3 piksel genişletilir: harfin etrafındaki JPEG halkalanması (soluk gri
    // gölge) kağıt dokusu sayılırsa temiz beyaz bir taramada yama kirli durur.
    const deltas: Array<number[] | null> = [];
    const ink = new Uint8Array(span * margin);
    for (let k = 0; k < margin; k++) {
      for (let j = 0; j < span; j++) {
        const x = j - margin;
        const color = at(x, rowOf(k));
        const base = reference(Math.max(0, Math.min(width - 1, x)));
        const delta = color ? [color[0] - base[0], color[1] - base[1], color[2] - base[2]] : null;
        deltas.push(delta);
        const lum = delta ? luminance(delta as Color) : 0;
        if (!delta || lum < -40 || lum > 40) ink[k * span + j] = 1; // harf, leke ya da parlama
      }
    }
    const HALO = 3;
    const tainted = (k: number, j: number) => {
      for (let dk = -HALO; dk <= HALO; dk++) {
        for (let dj = -HALO; dj <= HALO; dj++) {
          const kk = k + dk;
          const jj = j + dj;
          if (kk >= 0 && kk < margin && jj >= 0 && jj < span && ink[kk * span + jj]) return true;
        }
      }
      return false;
    };
    for (let k = 0; k < margin; k++) {
      const row = new Float32Array(span * 3);
      const valid = new Uint8Array(span);
      for (let j = 0; j < span; j++) {
        const delta = deltas[k * span + j];
        if (!delta || tainted(k, j)) continue;
        row.set(delta, j * 3);
        valid[j] = 1;
      }
      const good: number[] = [];
      for (let j = 0; j < span; j++) if (valid[j]) good.push(j);
      if (good.length < span * 0.3) continue;
      for (let j = 0; j < span; j++) {
        if (valid[j]) continue;
        const source = good[Math.floor(next() * good.length)];
        row.set(row.subarray(source * 3, source * 3 + 3), j * 3);
      }
      strips[which].push(row);
    }
  }
  const pool = [...strips[0], ...strips[1]];
  // Doku yalnızca dokudur: ortalaması sıfırlanır, yamanın tonu kenar
  // ölçülerinden gelir.
  if (pool.length) {
    const mean = [0, 0, 0];
    for (const row of pool) for (let j = 0; j < span; j++) for (let i = 0; i < 3; i++) mean[i] += row[j * 3 + i];
    for (let i = 0; i < 3; i++) mean[i] /= pool.length * span;
    for (const row of pool) for (let j = 0; j < span; j++) for (let i = 0; i < 3; i++) row[j * 3 + i] -= mean[i];
  }
  // Yama, şerit yüksekliğinde bloklarla döşenir; her blok üst ya da alt
  // şeridin kendisidir (iki boyutlu doku korunur), yatayda rastgele kaydırılır
  // ki aynı leke alt alta tekrarlanmasın.
  const blockHeight = Math.max(1, margin);
  const blocks = Array.from({ length: Math.ceil(height / blockHeight) }, (_, index) => {
    const source = strips[index % 2].length ? strips[index % 2] : strips[1 - (index % 2)];
    return { source, shift: Math.floor(next() * margin * 2) };
  });
  const texture = (x: number, y: number, channel: number): number => {
    if (!pool.length) return 0;
    const block = blocks[Math.floor(y / blockHeight)];
    if (!block.source.length) return 0;
    const row = block.source[(y % blockHeight) % block.source.length];
    const j = Math.min(span - 1, Math.max(0, x + block.shift));
    return row[j * 3 + channel];
  };

  const corner = (a: Color, b: Color) => [0, 1, 2].map((i) => (a[i] + b[i]) / 2) as Color;
  const c00 = corner(T(0), L(0));
  const c10 = corner(T(width - 1), R(0));
  const c01 = corner(B(0), L(height - 1));
  const c11 = corner(B(width - 1), R(height - 1));

  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const t = height === 1 ? 0.5 : y / (height - 1);
    const l = L(y);
    const r = R(y);
    for (let x = 0; x < width; x++) {
      const s = width === 1 ? 0.5 : x / (width - 1);
      const tt = T(x);
      const bb = B(x);
      for (let i = 0; i < 3; i++) {
        const value =
          (1 - t) * tt[i] +
          t * bb[i] +
          (1 - s) * l[i] +
          s * r[i] -
          ((1 - s) * (1 - t) * c00[i] + s * (1 - t) * c10[i] + (1 - s) * t * c01[i] + s * t * c11[i]);
        out[(y * width + x) * 3 + i] = Math.max(0, Math.min(255, Math.round(value + texture(x, y, i))));
      }
    }
  }
  return out;
}
