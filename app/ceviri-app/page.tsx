import { engineStatus } from "../../lib/ceviri/engines";
import Lingua from "./lingua";

export const metadata = { title: "Lingua | TTAA" };
export const dynamic = "force-dynamic";

export default function LinguaPage() {
  // Motor durumu sunucuda, ortam değişkenlerinden okunur; istemciye yalnızca
  // açık/kapalı bilgisi gider, anahtarın kendisi asla gitmez.
  return <Lingua engines={engineStatus()} />;
}
