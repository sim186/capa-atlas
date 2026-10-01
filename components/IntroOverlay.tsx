"use client";

import { useEffect, useState } from "react";
import PortraitBackdrop from "@/components/PortraitBackdrop";
import type { Portrait } from "@/lib/graph";

const WORDS = ["THE", "CAPA", "ATLAS"];
const SEEN_KEY = "atlas-intro-seen";

/**
 * Word-by-word intro with a hairline progress bar, then the curtain lifts
 * and the component removes itself from the DOM. Shown once per session,
 * skipped outright for reduced motion, and dismissible with a click or key.
 */
export default function IntroOverlay({ portrait }: { portrait?: Portrait }) {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // storage blocked: just play the intro
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const skip = () => setGone(true);
    const timer = window.setTimeout(skip, seen || reduced ? 0 : 2500);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      className="atlas-intro cursor-pointer"
      onClick={() => setGone(true)}
      role="presentation"
    >
      {/* same crop as the backdrop that appears when the curtain lifts, but
          at full strength: the opening shot is the face */}
      {portrait && <PortraitBackdrop portraits={[portrait]} index={0} strength={1.9} />}
      <h1 className="atlas-pen relative flex gap-[0.28em] text-4xl tracking-[-0.02em] sm:text-6xl">
        {WORDS.map((word, i) => (
          <span key={word} className="atlas-intro-word" style={{ "--i": i } as React.CSSProperties}>
            <span>{word}</span>
          </span>
        ))}
      </h1>
      <div
        className="relative h-px w-40 overflow-hidden sm:w-56"
        style={{ background: "var(--atlas-hair)" }}
      >
        <span
          className="block h-px"
          style={{
            background: "var(--atlas-ink)",
            animation: "atlasIntroBar 1s var(--atlas-ease) 0.45s both",
          }}
        />
      </div>
      <p className="relative text-xs opacity-60">Clicca per entrare</p>
    </div>
  );
}
