"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphNode } from "@/lib/graph";
import { GROUP_LABEL, type Group } from "@/lib/graph";
import { DrawablyBadge, DrawablyButton } from "drawably/react";
import { drawablyCard } from "drawably";

interface NodeDetailProps {
  node: GraphNode;
  neighbors: GraphNode[];
  /** Drives the slide-in/out transition; parent controls unmount. */
  open: boolean;
  onClose: () => void;
  /** Walk to a connected node. dir: 1 = forward, -1 = back. */
  onNavigate: (node: GraphNode, dir: 1 | -1) => void;
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 800px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 800px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/**
 * The node detail surface: a right-hand panel on desktop, a draggable
 * bottom sheet on mobile. Every open/re-nav replays the staggered reveal:
 * meta row, hairline rule, title, body blocks and pager each fade up at
 * ~52ms intervals with a soft overshoot ease.
 */
export default function NodeDetail({ node, neighbors, open, onClose, onNavigate }: NodeDetailProps) {
  const isDesktop = useIsDesktop();
  // Back-history for the pager and the direction of the last hop, used to
  // slide content in from the correct side. Both are state so render can
  // depend on them (e.g. disabling "back").
  const [history, setHistory] = useState<GraphNode[]>([]);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [dragging, setDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartRef = useRef<number | null>(null);
  // Sketchy frame drawn around the desktop panel (the "notebook margin").
  const surfaceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !isDesktop) return;
    const sketch = drawablyCard(surface, { width: 1.6, roughness: 0.8 });
    return () => sketch.destroy();
  }, [isDesktop]);

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

  // --- bottom-sheet drag-to-dismiss (mobile only) ---
  const onGripPointerDown = (event: React.PointerEvent) => {
    dragStartRef.current = event.clientY;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onGripPointerMove = (event: React.PointerEvent) => {
    if (dragStartRef.current === null) return;
    setDragY(Math.max(0, event.clientY - dragStartRef.current));
  };
  const onGripPointerUp = () => {
    if (dragStartRef.current === null) return;
    dragStartRef.current = null;
    setDragging(false);
    setDragY(0);
    if (dragY > 90) onClose();
  };

  const title = node.fragment && node.group === "keyword" ? node.fragment : node.label;
  const groupLabel = GROUP_LABEL[node.group as Group] ?? node.group;

  const body = (
    <div
      key={node.id}
      className="atlas-slide flex min-h-0 flex-1 flex-col"
      style={{ "--dir": direction } as React.CSSProperties}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col px-7 pb-6 pt-6 sm:px-10 sm:pt-8">
          <div
            className="atlas-reveal flex items-baseline justify-between gap-4 pr-12"
            style={{ "--i": 0 } as React.CSSProperties}
          >
            <span className="text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[color-mix(in_oklch,var(--atlas-ink)_64%,transparent)]">
              {groupLabel}
            </span>
            <span className="font-mono text-[0.64rem] tabular-nums tracking-[0.08em] text-[color-mix(in_oklch,var(--atlas-ink)_45%,transparent)]">
              {neighbors.length} collegamenti
            </span>
          </div>

          <span className="atlas-rule mt-5" style={{ "--i": 1 } as React.CSSProperties} />

          <h2
            className="atlas-title-reveal mt-7 font-sans text-4xl font-bold leading-[0.95] tracking-[-0.035em] text-balance sm:text-5xl"
            style={{ color: "var(--atlas-ink)" }}
          >
            {title}
          </h2>

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
              {node.url && (
                <a
                  href={node.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)]"
                >
                  Apri su Genius ↗
                </a>
              )}
            </div>
          )}

          {node.group === "keyword" && (
            <div
              className="atlas-reveal mt-6 flex flex-col items-start gap-4"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              {node.annotation && (
                <p className="text-[0.95rem] leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_78%,transparent)]">
                  {node.annotation}
                </p>
              )}
              {node.song && (
                <p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[color-mix(in_oklch,var(--atlas-ink)_50%,transparent)]">
                  — {node.song}
                </p>
              )}
              {node.url && (
                <a
                  href={node.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex font-mono text-[0.72rem] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_oklch,var(--atlas-ink)_38%,transparent)] hover:[text-decoration-color:var(--atlas-ink)]"
                >
                  Vedi annotazione su Genius ↗
                </a>
              )}
            </div>
 )}

          {node.group !== "song" && node.group !== "keyword" && (
            <p
              className="atlas-reveal mt-5 text-base leading-relaxed text-[color-mix(in_oklch,var(--atlas-ink)_80%,transparent)]"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              {node.fragment ??
                `Un elemento dell'atlante Caparezza, collegato a ${neighbors.length} ${
                  neighbors.length === 1 ? "nodo" : "nodi"
                }.`}
            </p>
          )}

          <span className="atlas-rule mt-8" style={{ "--i": 3 } as React.CSSProperties} />

          <div className="atlas-reveal mt-6 pb-4" style={{ "--i": 4 } as React.CSSProperties}>
            <p className="mb-3 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_46%,transparent)]">
              Collegato a
            </p>
            <ul className="flex flex-wrap gap-2">
              {neighbors.slice(0, 40).map((neighbor) => (
                <li key={neighbor.id}>
                  <DrawablyButton
                    onClick={() => openNeighbor(neighbor)}
                    width={1.4}
                    className="atlas-pen max-w-[16rem] truncate px-3 py-1.5 text-[0.82rem]"
                    title={neighbor.label}
                  >
                    <span className="atlas-roll">
                      <span>{neighbor.label}</span>
                      <span>{neighbor.label}</span>
                    </span>
                  </DrawablyButton>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* pager */}
      <div
        className="relative z-10 flex flex-none border-t"
        style={{ borderColor: "var(--atlas-hair)", background: "var(--atlas-bg)" }}
      >
        <button
          onClick={goPrev}
          disabled={history.length === 0}
          data-dir="prev"
          className="flex flex-1 items-center gap-3 px-7 py-4 text-left disabled:opacity-35 sm:px-10"
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
            <span className="block text-[0.56rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_42%,transparent)]">
              Indietro
            </span>
          </span>
        </button>
        <button
          onClick={goNext}
          disabled={neighbors.length === 0}
          data-dir="next"
          className="flex flex-1 items-center justify-end gap-3 border-l px-7 py-4 text-right disabled:opacity-35 sm:px-10"
          style={{ borderColor: "var(--atlas-hair)", color: "var(--atlas-ink)" }}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[0.56rem] font-bold uppercase tracking-[0.2em] text-[color-mix(in_oklch,var(--atlas-ink)_42%,transparent)]">
              {neighbors.length > 0 ? groupLabel : "—"}
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
          className="absolute right-6 top-6 z-10 h-10 w-10 p-0"
          aria-label="Chiudi pannello"
        >
          <span className="atlas-close-mark" />
        </DrawablyButton>
        {body}
      </aside>
    );
  }

  return (
    <div
      className="atlas-sheet"
      data-open={open}
      data-swiping={dragging}
      style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      role="dialog"
      aria-label="Dettaglio nodo"
    >
      <div
        className="atlas-grip"
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerUp}
      >
        <span className="atlas-grip-bar" />
      </div>
      {body}
    </div>
  );
}
