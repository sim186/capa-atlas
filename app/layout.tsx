import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "drawably/style.css";
import "drawably/font.css";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = SITE_TITLE;
const DESCRIPTION = SITE_DESCRIPTION;
const OG_IMAGE = {
  url: `${SITE_URL}/og.jpg`,
  width: 1200,
  height: 630,
  alt: "Atlas — L'universo di Caparezza: persone, eventi e idee che tornano di album in album",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ececec",
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: TITLE,
  url: `${SITE_URL}/`,
  description: DESCRIPTION,
  inLanguage: "it",
};

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_URL}/`),
  title: TITLE,
  keywords: ["Caparezza", "Atlas", "universo", "testi", "riferimenti", "citazioni", "atlante", "Genius"],
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/`,
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    locale: "it_IT",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col">
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
      </body>
    </html>
  );
}
