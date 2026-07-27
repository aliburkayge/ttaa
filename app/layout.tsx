import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "../public/translation-article.css";
import "../public/ay-tercume-article.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  return {
    title: "TTAA Content Studio",
    description: "Local-first SEO, AI visibility and WordPress content production studio for Turkish Translation & Attestation Agency.",
    openGraph: {
      title: "TTAA Content Studio",
      description: "SEO • AI Visibility • WordPress",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1672, height: 942, alt: "TTAA Content Studio interface preview" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "TTAA Content Studio",
      description: "SEO • AI Visibility • WordPress",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
