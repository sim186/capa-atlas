"use client";

import { useEffect, useState } from "react";
import { DrawablyCard } from "drawably/react";
import { sound } from "@/lib/sound";
import Link from "next/link";
import type { Portrait } from "@/lib/graph";
import { useLocale, useT } from "@/lib/locale";

/**
 * The "i" in the top-right corner — same gesture as the AI Coding
 * Dictionary that inspired this atlas: a hairline circle button that opens
 * a note about why the project exists and who to thank.
 */
export default function AboutPanel({
  themeBg,
  play,
  portraits = [],
}: {
  themeBg: string;
  play: (fn: () => void) => void;
  portraits?: Portrait[];
}) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="absolute right-6 top-6 z-20 flex flex-col items-end gap-3">
      <div className="flex items-center gap-2">
        {/* the other language: a separate page (own <html lang>), so a full load */}
        <Link
          href={t.otherLanguage.href}
          hrefLang={locale === "it" ? "en" : "it"}
          title={t.otherLanguage.title}
          className="atlas-circle-btn font-mono text-[0.68rem] font-bold tracking-[0.06em]"
        >
          {t.otherLanguage.label}
        </Link>
        <button
          onClick={() => {
            setOpen((value) => !value);
            play(() => sound.select());
          }}
          aria-label={open ? t.aboutClose : t.aboutOpen}
          aria-expanded={open}
          data-on={open}
          className="atlas-circle-btn atlas-pen text-lg leading-none"
        >
          i
        </button>
      </div>

      {open && (
        // opaque + scrollable: on a phone the card must stay above the tab bar
        // and must not let the map show through the text
        <div
          className="max-h-[calc(100dvh-13rem)] overflow-y-auto"
          style={{ background: themeBg, borderRadius: "0.9rem" }}
        >
        <DrawablyCard
          paper={themeBg}
          className="atlas-reveal w-[min(24rem,calc(100vw-3rem))] p-6 text-sm leading-relaxed"
          style={{
            "--i": 0,
            boxShadow: "0 16px 50px -20px rgba(0, 0, 0, 0.35)",
            animationDelay: "0ms",
          } as React.CSSProperties}
        >
{locale === "en" ? (
            <>
          <p className="atlas-pen text-xl tracking-[-0.02em]">Why this atlas</p>
          <div className="atlas-rule my-4" style={{ "--i": 1 } as React.CSSProperties} />

          <p>
            Caparezza writes lyrics that work like hypertext: every keyword
            underlined on Genius is a pointer, a quote, a character. The notes
            talk to each other across the albums — Vincent van Gogh answers
            consumerism, rebirth comes back from record to record. I wanted to
            see that whole web, not read it one song at a time.
          </p>

          <p className="mt-4">
            The idea comes from the{" "}
            <a
              href="https://aicodingdictionary.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:opacity-70"
            >
              AI Coding Dictionary
            </a>{" "}
            by{" "}
            <a
              href="https://github.com/mattpocock/dictionary-of-ai-coding"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:opacity-70"
            >
              Matt Pocock
            </a>
            : a dictionary you browse as a graph of concepts. Moved from the
            words of AI to the words of a songwriter, it became this atlas.
          </p>

          <p className="mt-4">
            This is the English edition: the interface, themes and Wikipedia
            summaries are in English where an English page exists. Lyrics and
            Genius annotations stay in Italian, and Italian text is marked{" "}
            <span className="font-mono text-[0.7rem] font-bold">IT</span>.
          </p>
            </>
          ) : (
            <>
          <p className="atlas-pen text-xl tracking-[-0.02em]">Perché questo atlas</p>
          <div className="atlas-rule my-4" style={{ "--i": 1 } as React.CSSProperties} />

          <p>
            Caparezza scrive testi che funzionano come ipertesti: ogni keyword
            sottolineata su Genius è un rimando, una citazione, un personaggio.
            Le note parlano tra loro attraverso gli album — Vincent van Gogh
            risponde al consumismo, la rinascita torna di disco in disco.
            Volevo vedere quella rete intera, non leggerla canzone per canzone.
          </p>

          <p className="mt-4">
            L&apos;idea arriva dal{" "}
            <a
              href="https://aicodingdictionary.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:opacity-70"
            >
              AI Coding Dictionary
            </a>{" "}
            di{" "}
            <a
              href="https://github.com/mattpocock/dictionary-of-ai-coding"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:opacity-70"
            >
              Matt Pocock
            </a>
            : un dizionario navigabile come grafo di concetti. Spostato dalle
            parole dell&apos;AI ai parole di un cantautore, è nato questo atlas.
          </p>
            </>
          )}

          <div className="atlas-rule my-5" style={{ "--i": 2 } as React.CSSProperties} />
          <p className="mb-3 font-mono text-[0.6rem] font-bold uppercase tracking-[0.2em] opacity-55">
            {t.credits}
          </p>
          <ul className="space-y-1.5 font-mono text-xs">
            <li>
              {t.creditData} ·{" "}
              <a
                href="https://genius.com/artists/Caparezza"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:opacity-70"
              >
                Genius
              </a>{" "}
              {t.creditDataNote}
            </li>
            <li>
              {t.creditInspiration} ·{" "}
              <a
                href="https://github.com/mattpocock/dictionary-of-ai-coding"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:opacity-70"
              >
                dictionary-of-ai-coding
              </a>{" "}
              {t.by} Matt Pocock
            </li>
            <li>
              {t.creditUi} ·{" "}
              <a
                href="https://github.com/Axyl101/drawably"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:opacity-70"
              >
                drawably
              </a>
            </li>
            <li>
              {t.creditGraph} ·{" "}
              <a
                href="https://github.com/vasturiano/react-force-graph"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:opacity-70"
              >
                react-force-graph-3d
              </a>{" "}
              {t.by} Vasco Asturiano
            </li>
            <li>
              {t.creditAuthor} ·{" "}
              <a
                href="https://github.com/sim186"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:opacity-70"
              >
                sim186
              </a>
            </li>
            <li>
              {t.creditCode} ·{" "}
              <a
                href="https://github.com/sim186/capa-atlas"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:opacity-70"
              >
                capa-atlas
              </a>
            </li>
          </ul>

          {portraits.length > 0 && (
            <>
              <p className="mb-2 mt-5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.2em] opacity-55">
                {t.backgroundPhotos}
              </p>
              <ul className="space-y-1.5 font-mono text-xs">
                {portraits.map((portrait) => (
                  <li key={portrait.file}>
                    <a
                      href={portrait.page}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-70"
                    >
                      {portrait.author}
                    </a>
                    {" · "}
                    {portrait.licenseUrl ? (
                      <a
                        href={portrait.licenseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:opacity-70"
                      >
                        {portrait.license}
                      </a>
                    ) : (
                      portrait.license
                    )}
                    , Wikimedia Commons
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-5 text-xs leading-snug opacity-65">
            {t.unofficial}
          </p>

          <p className="mt-2 text-xs leading-snug opacity-65">
            {t.coversNote}
          </p>
        </DrawablyCard>
        </div>
      )}
    </div>
  );
}
