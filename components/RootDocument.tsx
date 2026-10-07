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

/** Google Search Console ownership token (sim186.github.io/capa-atlas/). */
const GOOGLE_SITE_VERIFICATION = "fDujDsahIdQekx3IEDicvanmcKytu3IboBvKCxmZqTo";

/**
 * <head> for one page of the atlas. `paths` are the page's site-relative
 * paths in both languages, so each edition points at the other (hreflang).
 */
export function pageMetadata(
  locale: Locale,
  {
    paths,
    title,
    description,
    image,
  }: {
    paths: Record<Locale, string>;
    title: string;
    description: string;
    image?: { url: string; alt: string };
  }
): Metadata {
  const copy = SITE_COPY[locale];
  const url = `${SITE_URL}${paths[locale]}`;
  const ogImage = image ?? { url: `${SITE_URL}/og.jpg`, width: 1200, height: 630, alt: `${title}: ${copy.ogAlt}` };
  return {
    metadataBase: new URL(`${SITE_URL}/`),
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        it: `${SITE_URL}${paths.it}`,
        en: `${SITE_URL}${paths.en}`,
        "x-default": `${SITE_URL}${paths.it}`,
      },
    },
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      title,
      description,
      locale: copy.ogLocale,
      alternateLocale: locale === "it" ? SITE_COPY.en.ogLocale : SITE_COPY.it.ogLocale,
      images: [ogImage],
    },
    twitter: {
      card: image ? "summary" : "summary_large_image",
      title,
      description,
      images: [ogImage.url],
    },
  };
}

export function siteMetadata(locale: Locale): Metadata {
  return {
    ...pageMetadata(locale, {
      paths: { it: SITE_COPY.it.path, en: SITE_COPY.en.path },
      title: siteTitle(locale),
      description: SITE_COPY[locale].description,
    }),
    keywords: SITE_COPY[locale].keywords,
    verification: { google: GOOGLE_SITE_VERIFICATION },
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
