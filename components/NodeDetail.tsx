"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/basePath";
import GroupGlyph from "@/components/GroupGlyph";
import PortraitBackdrop from "@/components/PortraitBackdrop";
import type { GraphNode, Portrait, Quote } from "@/lib/graph";
import { LENS_GROUP_ORDER } from "@/lib/graph";
import { useT } from "@/lib/locale";
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

/** Genius' mark: the black-on-yellow badge from its app icon. */
function GeniusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
      <rect width="24" height="24" rx="4" fill="#FFFF64" />
      <text x="12" y="17.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="16" fontWeight="900" fill="#000">
        G
      </text>
    </svg>
  );
}

/** Wikipedia's serif W, in the ink colour like its own monochrome logo. */
function WikipediaIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
      <text x="12" y="18" textAnchor="middle" fontFamily="'Linux Libertine', Georgia, 'Times New Roman', serif" fontSize="21">
        W
      </text>
    </svg>
  );
}

function GeniusLink({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)] ${className}`}
    >
      <GeniusIcon />
      {label} ↗
    </a>
  );
}

function WikipediaLink({ href, className = "" }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)] ${className}`}
    >
      <WikipediaIcon />
      Wikipedia ↗
    </a>
  );
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

/** The song on Caparezza's own YouTube channel (data/youtube.json). */
function YouTubeLink({ video }: { video: NonNullable<GraphNode["youtube"]> }) {
  const t = useT();
  return (
    <a
      href={`https://www.youtube.com/watch?v=${video.id}`}
      target="_blank"
      rel="noreferrer"
      title={t.youtubeTitle}
      className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)]"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#FF0000]" fill="currentColor">
        <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" />
      </svg>
      {t.youtubeKind[video.kind]} ↗
    </a>
  );
}

/** English atlas: marks text still in Italian (no English source for it). */
function ItalianTag({ show }: { show?: boolean }) {
  const t = useT();
  if (!show || !t.italianTag) return null;
  return (
    <span
      title="In Italian"
      className="mr-1.5 inline-block rounded-sm border px-1 align-[0.12em] font-mono text-[0.55rem] font-bold leading-[1.35] tracking-[0.08em] text-[color-mix(in_oklch,var(--atlas-ink)_60%,transparent)]"
      style={{ borderColor: "var(--atlas-hair)" }}
    >
      {t.italianTag}
    </span>
  );
}

/** Wikipedia sections on what the album/song is about (concept, meaning, tracks). */
function AboutSections({ about, italian }: { about?: { heading: string; text: string }[]; italian?: boolean }) {
  if (!about?.length) return null;
  return (
    <div className="mt-4 space-y-4">
      {about.map((section) => (
        <section key={section.heading}>
          <h3 className="mb-1.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
            <ItalianTag show={italian} />
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
  const t = useT();
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
  const groupLabel = t.group[node.group] ?? node.group;
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
              {t.linkCount(linkCount)}
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
                alt={t.coverOf(node.group === "album" ? node.label : node.album)}
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
                    {t.albumField} · <span className="font-medium">{node.album}</span>
                  </span>
                )}
                {node.release && <span className="block">{t.releaseField} · {node.release}</span>}
              </p>
              {node.description && (
                <p className="mt-3 text-[0.95rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_78%,transparent)]">
                  <ItalianTag show={node.italian?.includes("description")} />
                  {node.description}
                </p>
              )}
              <AboutSections about={node.about} italian={node.italian?.includes("about")} />
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {node.url && (
                  <GeniusLink href={node.url} label={t.openOnGenius} className="text-[0.72rem]" />
                )}
                {node.descriptionUrl && (
                  <WikipediaLink href={node.descriptionUrl} />
                )}
                {node.youtube && <YouTubeLink video={node.youtube} />}
                {spotifyUrl && <SpotifyLink href={spotifyUrl} />}
              </p>
            </div>
          )}

          {node.group === "song" && node.quoteCount && (
            <div className="atlas-reveal mt-7" style={{ "--i": 2.5 } as React.CSSProperties}>
              <p className="mb-3 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
                {t.annotatedQuotes} · {node.quoteCount}
              </p>
              {t.quotesNote && (
                <p className="mb-3 text-[0.78rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_55%,transparent)]">
                  {t.quotesNote}
                </p>
              )}
              {quotes === null && (
                <p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] opacity-55">
                  {t.loading}
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
                          <GeniusLink href={quote.url} label={t.seeOnGenius} className="mt-2 text-[0.68rem]" />
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
                <ItalianTag show={node.italian?.includes("description")} />
                {node.description ?? t.fallbackDescription(linkCount)}
              </p>
              <AboutSections about={node.about} italian={node.italian?.includes("about")} />
              {node.bio && (
                <div className="mt-5">
                  <h3 className="mb-1.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
                    {t.whoIs}
                  </h3>
                  <p className="text-[0.95rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_78%,transparent)]">
                    <ItalianTag show={node.italian?.includes("bio")} />
                    {node.bio}
                  </p>
                  {node.bioUrl && (
                    <WikipediaLink href={node.bioUrl} className="mt-3" />
                  )}
                </div>
              )}
              {node.descriptionUrl && (
                <WikipediaLink href={node.descriptionUrl} className="mt-3" />
              )}
              {spotifyUrl && <SpotifyLink href={spotifyUrl} className="mt-3" />}
            </div>
          )}

          {node.group === "album" && node.tracks && node.tracks.length > 1 && (
            <div className="atlas-reveal mt-7" style={{ "--i": 2.5 } as React.CSSProperties}>
              <p className="mb-3 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
                {t.tracks} · {node.tracks.length}
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
              {t.linkedTo}
            </p>
            {/* Same blocks, order and captions as the lens on the map. */}
            <div className="flex flex-col gap-4">
              {LENS_GROUP_ORDER.map((group) => {
                const block = neighbors.filter((neighbor) => neighbor.group === group);
                if (block.length === 0) return null;
                return (
                  <section key={group}>
                    <h3 className="mb-2 inline-flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[color-mix(in_oklch,var(--atlas-ink)_55%,transparent)]">
                      <GroupGlyph group={group} size={9} distinct={distinctShapes} />
                      {t.groupPlural[group]} · {block.length}
                    </h3>
                    <ul className="flex flex-wrap gap-2">
                      {block.map((neighbor) => (
                        <li key={neighbor.id} {...hoverProps(neighbor)}>
                          <DrawablyButton
                            onClick={() => openNeighbor(neighbor)}
                            width={1.4}
                            className="atlas-pen atlas-pill max-w-[16rem] truncate text-[0.82rem]"
                            title={`${neighbor.label} · ${t.group[neighbor.group]}`}
                          >
                            <span className="atlas-roll">
                              <span>{neighbor.label}</span>
                              <span>{neighbor.label}</span>
                            </span>
                          </DrawablyButton>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
            {linkCount > neighbors.length && (
              <p className="mt-3 text-[0.78rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_55%,transparent)]">
                {t.strongestOnly(neighbors.length, linkCount - neighbors.length)}
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
              {t.back}
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
                  {t.group[neighbors[0].group]}
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
        aria-label={t.nodeDetail}
      >
        <DrawablyButton
          onClick={onClose}
          width={1.4}
          className="atlas-panel-close h-10 w-10 p-0"
          aria-label={t.closePanel}
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
      aria-label={t.nodeDetail}
    >
      <div className="atlas-sheet-bar">
        <button onClick={onClose} className="atlas-back">
          <span aria-hidden>←</span> {t.tabMap}
        </button>
      </div>
      {body}
    </div>
  );
}
