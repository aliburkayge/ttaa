import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isVerificationBrand } from "../../../lib/public-verification";
import VerificationWidget from "./verification-widget";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (!isVerificationBrand(brand)) notFound();
  return <VerificationWidget brand={brand} />;
}
