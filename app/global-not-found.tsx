import type { Metadata } from "next";
import { Comfortaa } from "next/font/google";
import "@/app/globals.css";
import { BASE_PATH } from "@/lib/basePath";
import { SITE_NAME } from "@/lib/site";

// The 404 for every URL no route matches. On GitHub Pages it is also what a
// trailing-slash address gets (/en/, /canzone/x/): the export writes en.html,
// not en/index.html. The script below strips the slash and retries before
// anything renders; a page that is still missing without it lands back here
// with no slash, so it can't loop.

const comfortaa = Comfortaa({
  variable: "--font-comfortaa",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `404 — ${SITE_NAME}`,
  robots: { index: false },
};

const STRIP_SLASH = `(function(){var p=location.pathname;if(p.length>1&&p.slice(-1)==="/"&&p!==${JSON.stringify(
  `${BASE_PATH}/`
)}){location.replace(p.replace(/\\/+$/,"")+location.search+location.hash)}})()`;

export default function GlobalNotFound() {
  return (
    <html lang="it" className={`${comfortaa.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STRIP_SLASH }} />
      </head>
      <body className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="atlas-pen text-3xl tracking-[-0.02em]">{SITE_NAME.toUpperCase()}</p>
        <div className="w-40"><div className="atlas-rule" /></div>
        <p>Questa pagina non esiste.</p>
        <p lang="en" className="opacity-70">
          This page does not exist.
        </p>
        <p className="mt-2 flex gap-6">
          <a href={`${BASE_PATH}/`} className="underline underline-offset-4 hover:opacity-70">
            Apri l&apos;atlas
          </a>
          <a href={`${BASE_PATH}/en`} lang="en" className="underline underline-offset-4 hover:opacity-70">
            Open the atlas
          </a>
        </p>
      </body>
    </html>
  );
}
