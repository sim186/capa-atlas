"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PortraitBackdrop from "@/components/PortraitBackdrop";
import type { Portrait } from "@/lib/graph";

const WORDS = ["THE", "CAPA", "ATLAS"];
const SEEN_KEY = "atlas-intro-seen";

/** Never hold the curtain longer than this, however slow the device. */
const MAX_WAIT_MS = 9000;
/** Shortest the intro stays up, so the words always get read. */
const MIN_SHOW_MS = 1800;

/**
 * Word-by-word intro over a hairline progress bar that tracks the scene
 * actually loading. The curtain lifts when the scene reports `ready` (and the
 * words have had their moment), not on a timer, so what's revealed is a graph
 * that is already drawing smoothly. Shown with no minimum once per session,
 * skipped outright for reduced motion, dismissible with a click or key; a
 * slow device is never held past MAX_WAIT_MS.
 */
export default function IntroOverlay({
  portrait,
  progress,
  ready,
  onReveal,
}: {
  portrait?: Portrait;
  /** 0–1 share of the scene that has loaded. */
  progress: number;
  /** The scene is drawing steadily and can be shown. */
  ready: boolean;
  /** Called once, as the curtain starts to lift. */
  onReveal?: () => void;
}) {
  const [minDone, setMinDone] = useState(false);
  const [forced, setForced] = useState(false);
  const leaving = forced || (minDone && ready);
  const [gone, setGone] = useState(false);
  const revealRef = useRef(onReveal);
  useEffect(() => {
    revealRef.current = onReveal;
  });

  const leave = useCallback(() => setForced(true), []);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // storage blocked: just play the intro
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const min = window.setTimeout(() => setMinDone(true), seen || reduced ? 0 : MIN_SHOW_MS);
    const max = window.setTimeout(leave, MAX_WAIT_MS);
    window.addEventListener("keydown", leave);
    return () => {
      window.clearTimeout(min);
      window.clearTimeout(max);
      window.removeEventListener("keydown", leave);
    };
  }, [leave]);

  useEffect(() => {
    if (!leaving) return;
    revealRef.current?.();
    const done = window.setTimeout(() => setGone(true), 600);
    return () => window.clearTimeout(done);
  }, [leaving]);

  if (gone) return null;

  return (
    <div
      className="atlas-intro cursor-pointer"
      data-leaving={leaving}
      onClick={leave}
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
        role="progressbar"
        aria-label="Caricamento della mappa"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span
          className="atlas-intro-bar block h-px w-full"
          style={{ background: "var(--atlas-ink)", transform: `scaleX(${progress})` }}
        />
      </div>
      <p className="relative text-xs opacity-60">
        {ready ? "Clicca per entrare" : "Carico la mappa…"}
      </p>
    </div>
  );
}
