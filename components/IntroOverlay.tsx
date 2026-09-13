"use client";

import { useEffect, useState } from "react";

const WORDS = ["THE", "CAPA", "ATLAS"];

/**
 * Word-by-word intro with a hairline progress bar, then the curtain lifts
 * and the component removes itself from the DOM.
 */
export default function IntroOverlay() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setGone(true), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  if (gone) return null;

  return (
    <div className="atlas-intro" aria-hidden>
      <h1 className="atlas-pen flex gap-[0.28em] text-4xl tracking-[-0.02em] sm:text-6xl">
        {WORDS.map((word, i) => (
          <span key={word} className="atlas-intro-word" style={{ "--i": i } as React.CSSProperties}>
            <span>{word}</span>
          </span>
        ))}
      </h1>
      <div
        className="h-px w-40 overflow-hidden sm:w-56"
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
    </div>
  );
}
