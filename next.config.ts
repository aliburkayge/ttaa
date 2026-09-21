import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "tsconfig.railway.json",
  },
  // PDF katmanı: pdf.js kendi çalışma dosyalarını ve WASM'ını çalışma anında
  // node_modules'tan okur; paketlenirse yolları bozulur. sharp yerel bir paket.
  serverExternalPackages: ["pdfjs-dist", "sharp"],
};

export default nextConfig;
