import path from "node:path";

/**
 * Uygulamanın diskteki dosyalarını (yazı tipleri, pdf.js çözücüleri) bulur.
 *
 * Ne import.meta.url'e ne require.resolve'a ne de tek başına process.cwd()'ye
 * güvenilir: Next'in paketleyicisi ilk ikisini kendi modül kimliğiyle
 * değiştiriyor, process.cwd() de sunucunun başlatıldığı klasörü veriyor —
 * projenin kendisi değil. Üçü de gerçek sunucuda dosyayı bulamayıp JBIG2
 * çözücüsünü ve yazı tiplerini sessizce devre dışı bıraktı.
 *
 * Burada birkaç gerçek başlangıç noktasından yukarı doğru yürünür ve dosyanın
 * varlığı doğrulanır. Node modülleri `process.getBuiltinModule` ile alınır ki
 * paketleyici bu çağrıları yeniden yazmasın.
 */

function anchors(): string[] {
  const list = [
    process.env.LINGUA_APP_ROOT,
    process.cwd(),
    process.argv[1] ? path.dirname(process.argv[1]) : undefined,
  ];
  return list.filter((anchor): anchor is string => Boolean(anchor));
}

const found = new Map<string, string>();

/** `relative` yolunu (ör. "lib/ceviri/fonts/Tinos-Regular.ttf") içeren ilk klasörü bulur; mutlak yolu döner. */
export function appFile(relative: string): string {
  const cached = found.get(relative);
  if (cached) return cached;
  const fs = process.getBuiltinModule("node:fs");
  for (const anchor of anchors()) {
    let dir = path.resolve(anchor);
    for (;;) {
      const candidate = path.join(dir, relative);
      if (fs.existsSync(candidate)) {
        found.set(relative, candidate);
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`Uygulama dosyası bulunamadı: ${relative}`);
}

/** Bir paketin kök klasörü, Node'un kendi çözücüsüyle. */
export function packageDir(name: string): string {
  const cached = found.get(`package:${name}`);
  if (cached) return cached;
  const nodeModule = process.getBuiltinModule("node:module");
  for (const anchor of anchors()) {
    try {
      const manifest = nodeModule.createRequire(path.join(anchor, "noop.js")).resolve(`${name}/package.json`);
      const dir = path.dirname(manifest);
      found.set(`package:${name}`, dir);
      return dir;
    } catch {
      // bir sonraki başlangıç noktası
    }
  }
  // Dışa aktarım listesi package.json'u gizleyen paketler için: klasörü yukarı yürüyerek ara.
  return path.dirname(appFile(path.join("node_modules", name, "package.json")));
}
