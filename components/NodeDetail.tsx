"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/basePath";
import GroupGlyph from "@/components/GroupGlyph";
import PortraitBackdrop from "@/components/PortraitBackdrop";
import type { GraphNode, Portrait, Quote } from "@/lib/graph";
import { GROUP_LABEL, type Group } from "@/lib/graph";
import { DrawablyBadge, DrawablyButton } from "drawably/react";
import { drawablyCard } from "drawably";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { spotifySearchUrl } from "@/lib/spotify";

interface NodeDetailProps {
  node: GraphNode;
  neighbors: GraphNode[];
  /** All of the node's links; `neighbors` is the strongest of them, as the lens draws them. */
  linkCount?: number;
  /** Drives the slide-in/out transition; parent controls unmount. */
  open: boolean;
  onClose: () => void;
  /** Walk to a connected node. dir: 1 = forward, -1 = back. */
  onNavigate: (node: GraphNode, dir: 1 | -1) => void;
  /** The "forme" accessibility option: category markers use distinct silhouettes. */
  distinctShapes?: boolean;
  /** The pointer resting on (or leaving) a connection or track: lights it on the map. */
  onHoverNode?: (node: GraphNode | null) => void;
  /** Any node by id: album track lists open their songs through it. */
  nodeById?: ReadonlyMap<string, GraphNode>;
  /** Phone sheet only: the portraits and which one this node's category wears. */
  portraits?: Portrait[];
  portraitIndex?: number;
}

const quoteCache = new Map<string, Quote[]>();

/** A song's annotated quotes, fetched on first open. null while loading. */
function useQuotes(node: GraphNode): Quote[] | null {
  const file = node.quotesFile;
  const [loaded, setLoaded] = useState<{ file: string; quotes: Quote[] } | null>(null);
  useEffect(() => {
    if (!file || quoteCache.has(file)) return;
    let cancelled = false;
    fetch(`${BASE_PATH}/quotes/${file}`)
      .then((res) => (res.ok ? (res.json() as Promise<Quote[]>) : []))
      .catch(() => [] as Quote[])
      .then((quotes) => {
        quoteCache.set(file, quotes);
        if (!cancelled) setLoaded({ file, quotes });
      });
    return () => {
      cancelled = true;
    };
  }, [file]);
  if (file && quoteCache.has(file)) return quoteCache.get(file)!;
  return loaded && loaded.file === file ? loaded.quotes : null;
}

function SpotifyLink({ href, className = "" }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)] ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#1DB954]" fill="currentColor">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.59 14.44a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.56-1.15a.75.75 0 1 1-.3-1.47c4.58-.94 8.49-.49 11.64 1.43.35.21.46.68.25 1.03Zm1.37-3.04a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.55-11.97-1.39a.94.94 0 1 1-.55-1.8c4.36-1.32 9.8-.68 13.5 1.58.44.27.58.85.31 1.3Zm.12-3.16C14.2 7.9 7.1 7.67 3.98 8.62a1.13 1.13 0 1 1-.66-2.17c3.58-1.09 11.36-.87 15.67 1.69a1.13 1.13 0 0 1-.91 2.06Z" />
      </svg>
      Spotify ↗
    </a>
  );
}

/** Wikipedia sections on what the album/song is about (concept, meaning, tracks). */
function AboutSections({ about }: { about?: { heading: string; text: string }[] }) {
  if (!about?.length) return null;
  return (
    <div className="mt-4 space-y-4">
      {about.map((section) => (
        <section key={section.heading}>
          <h3 className="mb-1.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
            {section.heading}
          </h3>
          {section.text
            .split("\n")
            .filter(Boolean)
            .map((para, i) => (
              <p
                key={i}
                className="mt-2 text-[0.95rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_78%,transparent)] first:mt-0"
              >
                {para}
              </p>
            ))}
        </section>
      ))}
    </div>
  );
}

/**
 * The node detail surface: a right-hand panel on desktop, a draggable
 * bottom sheet on mobile. Every open/re-nav replays the staggered reveal:
 * meta row, hairline rule, title, body blocks and pager each fade up at
 * ~52ms intervals with a soft overshoot ease.
 */
export default function NodeDetail({ node, neighbors, linkCount = neighbors.length, open, onClose, onNavigate, nodeById, distinctShapes = false, onHoverNode, portraits = [], portraitIndex = 0 }: NodeDetailProps) {
  const isDesktop = useIsDesktop();
  const quotes = useQuotes(node);
  // Back-history for the pager and the direction of the last hop, used to
  // slide content in from the correct side. Both are state so render can
  // depend on them (e.g. disabling "back").
  const [history, setHistory] = useState<GraphNode[]>([]);
  const [direction, setDirection] = useState<1 | -1>(1);
  // Sketchy frame drawn around the desktop panel (the "notebook margin").
  const surfaceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !isDesktop) return;
    const sketch = drawablyCard(surface, { width: 1.6, roughness: 0.8 });
    return () => sketch.destroy();
  }, [isDesktop]);

  // Hover lights a node on the map. A mouse only: on touch the sheet covers
  // the map, and a tap fires enter without a matching leave. Cleared when the
  // drawer moves on, since the hovered row unmounts without a leave event.
  const hoverProps = (target: GraphNode) => ({
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") onHoverNode?.(target);
    },
    onPointerLeave: () => onHoverNode?.(null),
  });
  useEffect(() => () => onHoverNode?.(null), [node.id, onHoverNode]);

  const goNext = useCallback(() => {
    if (neighbors.length === 0) return;
    setHistory((previous) => [...previous, node]);
    setDirection(1);
    onNavigate(neighbors[0], 1);
  }, [neighbors, node, onNavigate]);

  const goPrev = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    setDirection(-1);
    onNavigate(previous, -1);
  }, [history, onNavigate]);

  const openNeighbor = useCallback(
    (neighbor: GraphNode) => {
      setHistory((previous) => [...previous, node]);
      setDirection(1);
      onNavigate(neighbor, 1);
    },
    [node, onNavigate]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "ArrowRight") goNext();
      if (event.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev]);

  const title = node.label;
  const groupLabel = GROUP_LABEL[node.group as Group] ?? node.group;
  const spotifyUrl = spotifySearchUrl(node);

  const body = (
    <div
      key={node.id}
      className="atlas-slide flex min-h-0 flex-1 flex-col"
      style={{ "--dir": direction } as React.CSSProperties}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* The sheet covers the whole map on a phone, so the backdrop portraits
            would never be seen there: bring this category's portrait into the
            sheet as a masthead that fades into the page and scrolls away. */}
        {!isDesktop && portraits.length > 0 && (
          <PortraitBackdrop portraits={portraits} index={portraitIndex} className="atlas-plate" />
        )}
        <div className="relative flex flex-1 flex-col px-7 pb-6 pt-2 sm:px-10 sm:pt-8">
          <div
            className="atlas-reveal flex items-baseline justify-between gap-4 pr-12"
            style={{ "--i": 0 } as React.CSSProperties}
          >
            <span className="inline-flex items-center gap-2 self-center text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[color-mix(in_oklch,var(--atlas-ink)_64%,transparent)]">
              <GroupGlyph group={node.group} size={11} distinct={distinctShapes} />
              {groupLabel}
            </span>
            <span className="font-mono text-[0.64rem] tabular-nums tracking-[0.08em] text-[color-mix(in_oklch,var(--atlas-ink)_45%,transparent)]">
              {linkCount} collegamenti
            </span>
          </div>

          <span className="atlas-rule mt-3 sm:mt-5" style={{ "--i": 1 } as React.CSSProperties} />

          <h2
            className="atlas-title-reveal mt-5 font-sans sm:mt-7 text-3xl font-bold leading-[0.98] tracking-[-0.035em] text-balance sm:text-5xl"
            style={{ color: "var(--atlas-ink)" }}
          >
            {title}
          </h2>


          {node.cover && (
            <figure className="atlas-reveal mt-6 flex items-end gap-3" style={{ "--i": 1.5 } as React.CSSProperties}>
              {/* eslint-disable-next-line @next/next/no-img-element -- third-party artwork, loaded from its source, never proxied or stored */}
              <img
                src={node.cover}
                alt={`Copertina di ${node.group === "album" ? node.label : node.album}`}
                width={112}
                height={112}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-28 w-28 flex-none rounded-sm object-cover"
                style={{ boxShadow: "0 10px 30px -14px rgba(0, 0, 0, 0.55)" }}
                onError={(event) => (event.currentTarget.parentElement!.hidden = true)}
              />
              <figcaption className="text-[0.7rem] leading-snug text-[color-mix(in_oklch,var(--atlas-ink)_55%,transparent)]">
                {node.coverSourceUrl ? (
                  <a
                    href={node.coverSourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-1 underline-offset-4"
                  >
                    {node.coverSource}
                  </a>
                ) : (
                  node.coverSource
                )}
              </figcaption>
            </figure>
          )}

          {node.group === "song" && (
            <div className="atlas-reveal mt-5" style={{ "--i": 2 } as React.CSSProperties}>
              <p className="text-base leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_80%,transparent)]">
                {node.album && (
                  <span className="block">
                    Album · <span className="font-medium">{node.album}</span>
                  </span>
                )}
                {node.release && <span className="block">Uscita · {node.release}</span>}
              </p>
              {node.description && (
                <p className="mt-3 text-[0.95rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_78%,transparent)]">
                  {node.description}
                </p>
              )}
              <AboutSections about={node.about} />
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {node.url && (
                  <a
                    href={node.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)]"
                  >
                    Apri su Genius ↗
                  </a>
                )}
                {node.descriptionUrl && (
                  <a
                    href={node.descriptionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)]"
                  >
                    Wikipedia ↗
                  </a>
                )}
                {spotifyUrl && <SpotifyLink href={spotifyUrl} />}
              </p>
            </div>
          )}

          {node.group === "song" && node.quoteCount && (
            <div className="atlas-reveal mt-7" style={{ "--i": 2.5 } as React.CSSProperties}>
              <p className="mb-3 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
                Citazioni annotate · {node.quoteCount}
              </p>
              {quotes === null && (
                <p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] opacity-55">
                  Carico…
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {(quotes ?? []).map((quote, index) => (
                  <li key={index}>
                    <details className="group rounded-md border" style={{ borderColor: "var(--atlas-hair)" }}>
                      <summary className="cursor-pointer list-none px-3 py-2.5 text-[0.86rem] font-medium leading-snug marker:content-none">
                        {quote.fragment}
                      </summary>
                      <div className="border-t px-3 py-3" style={{ borderColor: "var(--atlas-hair)" }}>
                        <p className="text-[0.85rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_78%,transparent)]">
                          {quote.annotation}
                        </p>
                        {quote.url && (
                          <a
                            href={quote.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex font-mono text-[0.68rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)]"
                          >
                            Vedi su Genius ↗
                          </a>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {node.group !== "song" && (
            <div className="atlas-reveal mt-5" style={{ "--i": 2 } as React.CSSProperties}>
              {node.blurb && (
                <p className="text-base leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_80%,transparent)]">
                  {node.blurb}
                </p>
              )}
              <p
                className={
                  node.blurb
                    ? "mt-3 text-[0.95rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_62%,transparent)]"
                    : "text-base leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_80%,transparent)]"
                }
              >
                {node.description ??
                  `Un elemento dell'atlante Caparezza, collegato a ${linkCount} ${
                    linkCount === 1 ? "nodo" : "nodi"
                  }.`}
              </p>
              <AboutSections about={node.about} />
              {node.bio && (
                <div className="mt-5">
                  <h3 className="mb-1.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
                    Chi è
                  </h3>
                  <p className="text-[0.95rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_78%,transparent)]">
                    {node.bio}
                  </p>
                  {node.bioUrl && (
                    <a
                      href={node.bioUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)]"
                    >
                      Wikipedia ↗
                    </a>
                  )}
                </div>
              )}
              {node.descriptionUrl && (
                <a
                  href={node.descriptionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)]"
                >
                  Wikipedia ↗
                </a>
              )}
              {spotifyUrl && <SpotifyLink href={spotifyUrl} className="mt-3" />}
            </div>
          )}

          {node.group === "album" && node.tracks && node.tracks.length > 1 && (
            <div className="atlas-reveal mt-7" style={{ "--i": 2.5 } as React.CSSProperties}>
              <p className="mb-3 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
                Tracce · {node.tracks.length}
              </p>
              <ol className="flex flex-col">
                {node.tracks.map((track, index) => {
                  const song = track.id ? nodeById?.get(track.id) : undefined;
                  const number = (
                    <span className="w-6 flex-none font-mono text-[0.68rem] tabular-nums text-[color-mix(in_oklch,var(--atlas-ink)_45%,transparent)]">
                      {index + 1}
                    </span>
                  );
                  return (
                    <li key={`${index}:${track.label}`} className="border-b" style={{ borderColor: "var(--atlas-hair)" }}>
                      {song ? (
                        <button
                          {...hoverProps(song)}
                          onClick={() => openNeighbor(song)}
                          className="group flex w-full items-baseline gap-2 py-2 text-left text-[0.9rem] leading-snug"
                          style={{ color: "var(--atlas-ink)" }}
                        >
                          {number}
                          <span className="min-w-0 flex-1 underline-offset-4 group-hover:underline">{track.label}</span>
                        </button>
                      ) : (
                        <span className="flex items-baseline gap-2 py-2 text-[0.9rem] leading-snug" style={{ color: "var(--atlas-ink)" }}>
                          {number}
                          <span className="min-w-0 flex-1">{track.label}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <span className="atlas-rule mt-8" style={{ "--i": 3 } as React.CSSProperties} />

          <div className="atlas-reveal mt-6 pb-4" style={{ "--i": 4 } as React.CSSProperties}>
            <p className="mb-3 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
              Collegato a
            </p>
            <ul className="flex flex-wrap gap-2">
              {neighbors.map((neighbor) => (
                <li key={neighbor.id} {...hoverProps(neighbor)}>
                  <DrawablyButton
                    onClick={() => openNeighbor(neighbor)}
                    width={1.4}
                    className="atlas-pen atlas-pill max-w-[16rem] truncate text-[0.82rem]"
                    title={`${neighbor.label} · ${GROUP_LABEL[neighbor.group]}`}
                  >
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                      <GroupGlyph group={neighbor.group} size={9} distinct={distinctShapes} />
                      <span className="atlas-roll min-w-0 truncate">
                        <span>{neighbor.label}</span>
                        <span>{neighbor.label}</span>
                      </span>
                    </span>
                  </DrawablyButton>
                </li>
              ))}
            </ul>
            {linkCount > neighbors.length && (
              <p className="mt-3 text-[0.78rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_55%,transparent)]">
                I {neighbors.length} legami più forti, come sulla mappa. Altri{" "}
                {linkCount - neighbors.length} più deboli non sono mostrati.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* pager */}
      <div
        className="atlas-pager relative z-10 flex flex-none border-t"
        style={{ borderColor: "var(--atlas-hair)", background: "var(--atlas-bg)" }}
      >
        <button
          onClick={goPrev}
          disabled={history.length === 0}
          data-dir="prev"
          className="flex min-w-0 flex-1 items-center gap-3 px-5 py-4 text-left disabled:opacity-35 sm:px-10"
          style={{ color: "var(--atlas-ink)" }}
        >
          <DrawablyBadge
            variant="outline"
            width={1.4}
            className="atlas-pager-arrow h-9 w-9 flex-none p-0 text-base"
          >
            ←
          </DrawablyBadge>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.62rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_70%,transparent)]">
              Indietro
            </span>
          </span>
        </button>
        <button
          onClick={goNext}
          disabled={neighbors.length === 0}
          data-dir="next"
          className="flex min-w-0 flex-1 items-center justify-end gap-3 border-l px-5 py-4 text-right disabled:opacity-35 sm:px-10"
          style={{ borderColor: "var(--atlas-hair)", color: "var(--atlas-ink)" }}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[0.62rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_70%,transparent)]">
              {neighbors[0] ? (
                <span className="inline-flex items-center gap-1.5">
                  <GroupGlyph group={neighbors[0].group} size={9} distinct={distinctShapes} />
                  {GROUP_LABEL[neighbors[0].group]}
                </span>
              ) : (
                "—"
              )}
            </span>
            <span className="atlas-roll max-w-full truncate text-[0.82rem] font-medium">
              <span>{neighbors[0]?.label ?? "—"}</span>
              <span>{neighbors[0]?.label ?? "—"}</span>
            </span>
          </span>
          <DrawablyBadge
            variant="outline"
            width={1.4}
            className="atlas-pager-arrow h-9 w-9 flex-none p-0 text-base"
          >
            →
          </DrawablyBadge>
        </button>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <aside
        ref={surfaceRef}
        className="atlas-panel"
        data-open={open}
        aria-label="Dettaglio nodo"
      >
        <DrawablyButton
          onClick={onClose}
          width={1.4}
          className="atlas-panel-close h-10 w-10 p-0"
          aria-label="Chiudi pannello"
        >
          <span className="atlas-close-mark" />
        </DrawablyButton>
        {body}
      </aside>
    );
  }

  // Phones get a full page, not a drawer over the 3D view: the map behind
  // made the text hard to read and the whole thing confusing.
  return (
    <div
      className="atlas-sheet"
      data-open={open}
      role="dialog"
      aria-label="Dettaglio nodo"
    >
      <div className="atlas-sheet-bar">
        <button onClick={onClose} className="atlas-back">
          <span aria-hidden>←</span> Mappa
        </button>
      </div>
      {body}
    </div>
  );
}
