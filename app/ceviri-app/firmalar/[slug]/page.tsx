import Firm from "./firm";

export const metadata = { title: "Firma | Lingua" };

export default async function FirmPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Firm slug={decodeURIComponent(slug)} />;
}
