import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "tsconfig.railway.json",
  },
  // PDF katmanı: pdf.js kendi çalışma dosyalarını ve WASM'ını çalışma anında
  // node_modules'tan okur; paketlenirse yolları bozulur. sharp ve
  // @napi-rs/canvas (pdf.js'in Node'da sayfa çizdiği tuval) yerel paketler.
  serverExternalPackages: ["pdfjs-dist", "sharp", "@napi-rs/canvas"],
};

export default nextConfig;
