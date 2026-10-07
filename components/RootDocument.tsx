import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "drawably/style.css";
import "drawably/font.css";
import "@/app/globals.css";
import type { Locale } from "@/lib/i18n";
import { SITE_COPY, SITE_NAME, SITE_URL, siteTitle } from "@/lib/site";

// The atlas has one root layout per language (app/(it), app/(en)) so each
// page is served with its own <html lang>; both are this document.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ececec",
};

export function siteMetadata(locale: Locale): Metadata {
  const copy = SITE_COPY[locale];
  const title = siteTitle(locale);
  const url = `${SITE_URL}${copy.path}`;
  const image = { url: `${SITE_URL}/og.jpg`, width: 1200, height: 630, alt: `${title}: ${copy.ogAlt}` };
  return {
    metadataBase: new URL(`${SITE_URL}/`),
    title,
    keywords: copy.keywords,
    description: copy.description,
    alternates: {
      canonical: url,
      languages: {
        it: `${SITE_URL}${SITE_COPY.it.path}`,
        en: `${SITE_URL}${SITE_COPY.en.path}`,
        "x-default": `${SITE_URL}${SITE_COPY.it.path}`,
      },
    },
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      title,
      description: copy.description,
      locale: copy.ogLocale,
      alternateLocale: locale === "it" ? SITE_COPY.en.ogLocale : SITE_COPY.it.ogLocale,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: copy.description,
      images: [image.url],
    },
  };
}

export default function RootDocument({ locale, children }: { locale: Locale; children: ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteTitle(locale),
    url: `${SITE_URL}${SITE_COPY[locale].path}`,
    description: SITE_COPY[locale].description,
    inLanguage: locale,
  };
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col">
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
