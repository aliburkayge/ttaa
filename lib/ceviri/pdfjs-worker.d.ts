// pdf.js işçi modülünün tip tanımı yok; yalnızca ana iş parçacığına verilir.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
