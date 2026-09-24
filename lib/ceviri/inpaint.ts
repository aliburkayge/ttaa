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
function paperOf(pixels: Color[], floor: number, band = 40): Color | null {
  if (pixels.length < 3) return null;
  const lums = pixels.map(luminance).sort((a, b) => b - a);
  const reference = lums[Math.floor(lums.length * 0.3)];
  if (reference < floor) return null;
  const paper = pixels.filter((color) => luminance(color) >= reference - band);
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
  options: {
    margin: number;
    window?: number;
    seed?: number;
    fallback: Color;
    /** Yamanın içinde değişmeyen (kağıdı görünen) pikseller; verilirse ton yerel ölçülür. */
    visible?: (x: number, y: number) => boolean;
    /**
     * Kenar şeritlerinden doku eklenir mi (varsayılan evet). Maskeli dolguda
     * hayır: dikdörtgenin kenarı imzanın yanındaki satırlardan geçer, oradan
     * gelen doku silinen imzanın yerini lekeliyordu; doku bağışçılardan gelir.
     */
    texture?: boolean;
  },
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
    // Doku, kağıdın kendi gren düzeyiyle sınırlanır (sapmaların ortanca
    // mutlak değeri). Temiz beyaz bir taramada gren yoktur; şeritteki yazının
    // yanından gelen soluk JPEG izi yamaya gri lekeler olarak taşınıyor, silinen
    // imzanın yerinde onun şeklinde bir hayalet bırakıyordu (NJ mektubu).
    const magnitudes: number[] = [];
    for (const row of pool) for (let j = 0; j < span; j += 3) magnitudes.push(Math.abs(luminance([row[j * 3], row[j * 3 + 1], row[j * 3 + 2]])));
    magnitudes.sort((a, b) => a - b);
    const grain = magnitudes[Math.floor(magnitudes.length / 2)] ?? 0;
    const limit = Math.max(1, grain * 2.5);
    for (const row of pool) {
      for (let j = 0; j < span; j++) {
        const delta = luminance([row[j * 3], row[j * 3 + 1], row[j * 3 + 2]]);
        if (Math.abs(delta) <= limit) continue;
        const scale = limit / Math.abs(delta);
        for (let i = 0; i < 3; i++) row[j * 3 + i] *= scale;
      }
    }
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

  const coons = (x: number, y: number): Color => {
    const t = height === 1 ? 0.5 : y / (height - 1);
    const s = width === 1 ? 0.5 : x / (width - 1);
    const tt = T(x);
    const bb = B(x);
    const l = L(y);
    const r = R(y);
    return [0, 1, 2].map(
      (i) =>
        (1 - t) * tt[i] +
        t * bb[i] +
        (1 - s) * l[i] +
        s * r[i] -
        ((1 - s) * (1 - t) * c00[i] + s * (1 - t) * c10[i] + (1 - s) * t * c01[i] + s * t * c11[i]),
    ) as Color;
  };

  // Maskeli yamada (yalnızca imzanın pikselleri değişir) kağıdın tonu yamanın
  // içinde görünen kağıttan, yerel olarak ölçülür. Dikdörtgenin kenarları
  // imzanın çevresindeki yazı satırlarından geçer; oradan ölçülen ton biraz
  // koyu çıkıyor, silinen imza yerinde gri bir hayalet olarak kalıyordu (NJ
  // mektubu). Kağıt görünmeyen hücrelerde kenarlardan kurulan ton kalır.
  const base = (() => {
    const visible = options.visible;
    if (!visible) return coons;
    const cell = 12;
    const gw = Math.ceil(width / cell);
    const gh = Math.ceil(height / cell);
    const grid: Array<Color | null> = new Array(gw * gh).fill(null);
    // Yalnızca genel kağıda yakın pikseller: yamanın içinde görünen başka bir
    // işaretin (mühür yayı) açık kenarı kağıt sayılırsa yama onun renginde
    // lekeleniyordu (Priaxor: başlığın yamasında turkuaz noktalar).
    const generalLum = luminance(general);
    const generalChroma = Math.max(...general) - Math.min(...general);
    const paperLike = (color: Color) =>
      Math.abs(luminance(color) - generalLum) <= 20 &&
      Math.abs(Math.max(...color) - Math.min(...color) - generalChroma) <= 12;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        // Pencere hücrenin iki yanındaki hücreleri de kapsar: yoğun imzanın
        // yanında görünen kağıdın çoğu mürekkebin grisidir, gerçek kağıt biraz ötededir.
        const pixels: Color[] = [];
        for (let y = gy * cell - cell; y < (gy + 1) * cell + cell; y++) {
          for (let x = gx * cell - cell; x < (gx + 1) * cell + cell; x++) {
            if (x < 0 || y < 0 || x >= width || y >= height || !visible(x, y)) continue;
            const color = at(x, y);
            if (color && paperLike(color)) pixels.push(color);
          }
        }
        // Dar bant: hücredeki yazının ve imzanın soluk halesi, JPEG'in
        // yoğun mürekkep çevresinde bıraktığı gri pus kağıt tonuna katılmaz.
        if (pixels.length >= cell) grid[gy * gw + gx] = paperOf(pixels, floor, 4);
      }
    }
    // Kağıdı görünmeyen hücre (imzanın yoğun yeri) en yakın ölçülen hücrelerin
    // tonunu alır. Kenardan kurulan ton o hücrelere düşünce dikdörtgenin kenarı
    // yazı satırlarından geçtiği için koyu çıkıyor, silinen imzanın yoğun
    // yerleri gri lekeler olarak kalıyordu (NJ mektubu 1. sayfa).
    if (grid.some(Boolean)) {
      while (grid.some((value) => !value)) {
        const next = grid.slice();
        for (let gy = 0; gy < gh; gy++) {
          for (let gx = 0; gx < gw; gx++) {
            if (grid[gy * gw + gx]) continue;
            const around: Color[] = [];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const x = gx + dx;
              const y = gy + dy;
              const value = x >= 0 && y >= 0 && x < gw && y < gh ? grid[y * gw + x] : null;
              if (value) around.push(value);
            }
            if (around.length) next[gy * gw + gx] = [0, 1, 2].map((i) => around.reduce((sum, c) => sum + c[i], 0) / around.length) as Color;
          }
        }
        grid.splice(0, grid.length, ...next);
      }
    }
    const value = (gx: number, gy: number): Color => {
      const cx = Math.max(0, Math.min(gw - 1, gx));
      const cy = Math.max(0, Math.min(gh - 1, gy));
      return grid[cy * gw + cx] ?? coons(Math.min(width - 1, cx * cell + cell / 2), Math.min(height - 1, cy * cell + cell / 2));
    };
    return (x: number, y: number): Color => {
      const fx = (x - cell / 2) / cell;
      const fy = (y - cell / 2) / cell;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const a = value(x0, y0);
      const b = value(x0 + 1, y0);
      const c = value(x0, y0 + 1);
      const d = value(x0 + 1, y0 + 1);
      return [0, 1, 2].map(
        (i) => (1 - ay) * ((1 - ax) * a[i] + ax * b[i]) + ay * ((1 - ax) * c[i] + ax * d[i]),
      ) as Color;
    };
  })();

  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = base(x, y);
      for (let i = 0; i < 3; i++) {
        const grain = options.texture === false ? 0 : texture(x, y, i);
        out[(y * width + x) * 3 + i] = Math.max(0, Math.min(255, Math.round(value[i] + grain)));
      }
    }
  }
  return out;
}

/**
 * Maskeli silmenin dolgusu: kağıt yeniden kurulur, silinen pikseller çevredeki
 * gerçek kağıttan doldurulur. Ton da bağışçı da işaretin `halo` piksel
 * çevresinden alınmaz: orası imzanın maskeye girmeyen soluk halesidir, oradan
 * alınan dolgu imzanın şeklini gri olarak geri çiziyordu (NJ mektubu 1. sayfa).
 */
export function fillErased(
  sample: (x: number, y: number) => Color | null,
  width: number,
  height: number,
  masked: Uint8Array,
  options: { margin: number; seed: number; paper: Color; radius: number; halo: number },
): Uint8Array {
  const near = dilate(masked, width, height, options.halo);
  const patch = reconstructPaper(sample, width, height, {
    margin: options.margin,
    window: 3,
    seed: options.seed,
    fallback: options.paper,
    visible: (x, y) => !near[y * width + x],
    texture: false,
  });
  donorFill(patch, width, height, sample, (x, y) => masked[y * width + x] === 1, {
    radius: options.radius,
    seed: options.seed,
    paper: options.paper,
    near: (x, y) => near[y * width + x] === 1,
  });
  return patch;
}

/** Maskeyi her yöne `radius` piksel büyütür (kare komşuluk). */
export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const rows = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) if (mask[y * width + x]) last = x;
    // Soldan sağa ve sağdan sola son maskeli pikselin uzaklığı.
    let seen = -Infinity;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) seen = x;
      if (x - seen <= radius) rows[y * width + x] = 1;
    }
    seen = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[y * width + x]) seen = x;
      if (seen - x <= radius) rows[y * width + x] = 1;
    }
    void last;
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let seen = -Infinity;
    for (let y = 0; y < height; y++) {
      if (rows[y * width + x]) seen = y;
      if (y - seen <= radius) out[y * width + x] = 1;
    }
    seen = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (rows[y * width + x]) seen = y;
      if (seen - y <= radius) out[y * width + x] = 1;
    }
  }
  return out;
}

/** Uzak kağıdın bu payı yalıtılmış noktacıksa kağıt noktacıklıdır (JBIG2 taraması). */
const SPECKLED_SHARE = 0.005;

/**
 * Silinen pikseller çevredeki gerçek kağıttan doldurulur: her birine 2..`radius`
 * piksel uzaktan rastgele bir bağışçı piksel (taramanın orijinali) kopyalanır.
 * Bağışçı ya temiz kağıttır (o pikselin yerel kağıt tonuna — `patch`'teki
 * kurulmuş değere — yakın parlaklık ve renk; gölgeli telefon fotoğrafında
 * genel tona göre seçilen bağışçı dolguyu açık bırakıyordu) ya da noktacıklı
 * kağıtta yalıtılmış bir noktacıktır: 7×7 penceresinin kenar halkasında hiç
 * koyu piksel yok. İnce harf ya da imza darbesi pencerenin kenarına mutlaka
 * ulaşır. Böylece dolgu kağıdın kendi dokusunu taşır: noktacıklı (JBIG2)
 * taramada temiz dolgu, silinen imzanın yerinde açık bir dikdörtgen ve imzanın
 * açık silüeti olarak görünüyordu (NJ mektubu 3. sayfa).
 *
 * Bağışçı olamaz: silinen alanın kendisi (mührün kağıda yakın soluk kenarı
 * oradan kopyalanınca halkası geri geliyordu, DELAN SC), `near` (işaretin
 * soluk halesi), hale ve renkli mürekkep. Kağıdın uzak kısmında noktacık
 * yoksa (temiz tarama) koyu nokta hiç kopyalanmaz: orada yalıtılmış koyu
 * piksel imzanın maskeye girmemiş kırıntısıdır, silinen imzanın yerine siyah
 * noktalar olarak taşınıyordu (NJ mektubu 1. sayfa).
 * Uygun bağışçı bulunamayan pikselin rengi değişmez.
 */
export function donorFill(
  patch: Uint8Array,
  width: number,
  height: number,
  sample: (x: number, y: number) => Color | null,
  masked: (x: number, y: number) => boolean,
  options: { radius: number; seed: number; paper: Color; near?: (x: number, y: number) => boolean },
): void {
  const next = random(options.seed);
  const paperLum = luminance(options.paper);
  const paperChroma = Math.max(...options.paper) - Math.min(...options.paper);
  const dark = (x: number, y: number) => {
    const color = sample(x, y);
    return Boolean(color) && luminance(color as Color) < paperLum - 60;
  };
  const isolated = (x: number, y: number) => {
    for (let k = -3; k <= 3; k++) {
      if (dark(x + k, y - 3) || dark(x + k, y + 3) || dark(x - 3, y + k) || dark(x + 3, y + k)) return false;
    }
    return true;
  };
  const excluded = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && (masked(x, y) || Boolean(options.near?.(x, y)));
  // Noktacıklı kağıt mı: işaretten uzak kağıdın binde beşinden çoğu yalıtılmış noktacık.
  let far = 0;
  let specks = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (excluded(x, y)) continue;
      far++;
      if (dark(x, y) && isolated(x, y)) specks++;
    }
  }
  const speckled = far > 0 && specks / far >= SPECKLED_SHARE;
  const donor = (x: number, y: number, local: number): Color | null => {
    if (excluded(x, y)) return null;
    const color = sample(x, y);
    if (!color) return null;
    const lum = luminance(color);
    const chroma = Math.max(...color) - Math.min(...color);
    if (chroma > paperChroma + 15) return null;
    // Kağıt: yerel tondan en çok 12 açık, en çok 4 koyu. Daha koyusu mürekkebin
    // çevresindeki gri pustur; dolguya taşınınca silinen imzanın şeklini
    // açık gri çiziyordu (NJ mektubu 3. sayfa).
    if (lum - local <= 12 && local - lum <= 4) return color;
    if (lum >= paperLum - 60 || !speckled) return null; // hale, soluk iz ya da temiz kağıtta kırıntı
    return isolated(x, y) ? color : null;
  };
  const reach = Math.max(3, options.radius);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!masked(x, y)) continue;
      const at = (y * width + x) * 3;
      const local = luminance([patch[at], patch[at + 1], patch[at + 2]]);
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = next() * Math.PI * 2;
        const distance = 2 + next() * (reach - 2);
        const color = donor(Math.round(x + Math.cos(angle) * distance), Math.round(y + Math.sin(angle) * distance), local);
        if (!color) continue;
        patch.set(color, (y * width + x) * 3);
        break;
      }
    }
  }
}

/**
 * Maskeyi tarama çözünürlüğünde, soluk komşulara doğru `rings` halka büyütür:
 * kağıttan belirgin koyu (8 düzeyden fazla) ama mürekkep sayılmayacak kadar
 * açık (70 düzeyden az) ya da kağıttan renkli pikseller. Maske 0,6 puntoluk
 * hücrelerle kurulur; darbenin yumuşak kenarı hücrenin dışında kalıp silinen
 * imzanın soluk silüetini, mührün soluk halkasını bırakıyordu. Koyu mürekkebe
 * (yanındaki harf), temiz kağıda ve `blocked` piksellere (çizginin soluk
 * kısmı: silinirse yeniden çizilmeyen yerde kesik kalıyordu) girmez.
 */
export function growFaint(
  masked: Uint8Array,
  width: number,
  height: number,
  sample: (x: number, y: number) => Color | null,
  paper: Color,
  rings: number,
  blocked: (x: number, y: number) => boolean = () => false,
): Uint8Array {
  const out = masked.slice();
  const paperLum = luminance(paper);
  const paperChroma = Math.max(...paper) - Math.min(...paper);
  const faint = (x: number, y: number) => {
    const color = sample(x, y);
    if (!color) return false;
    const lum = luminance(color);
    const chroma = Math.max(...color) - Math.min(...color);
    if (lum < paperLum - 70) return false;
    return lum < paperLum - 8 || chroma > paperChroma + 12;
  };
  for (let ring = 0; ring < rings; ring++) {
    const add: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (out[i]) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1 && !touches; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < width && yy < height && out[yy * width + xx]) touches = true;
          }
        }
        if (touches && !blocked(x, y) && faint(x, y)) add.push(i);
      }
    }
    if (!add.length) break;
    for (const i of add) out[i] = 1;
  }
  return out;
}
