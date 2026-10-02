import { BASE_PATH } from "@/lib/basePath";
import type { Portrait } from "@/lib/graph";

// Where the face sits in each frame, so the crop keeps it clear of the fade.
// Falls back to the centre for any portrait added later.
const FOCUS: Record<string, string> = {
  "caparezza-live-koko-london-12-10-2014-15528942992.jpg": "50% 28%",
  "caparezza.jpg": "50% 35%",
  "caparezza-live-koko-london-12-10-2014-14908207664.jpg": "70% 30%",
  "caparezza-live-koko-london-12-10-2014-15342885610.jpg": "58% 25%",
};

/**
 * Caparezza behind the graph: a duotone-ish (greyscale, dimmed) photo pinned
 * to the right, dissolving into the page colour toward the left with a
 * horizontal alpha mask — so the map stays readable and the face still says
 * whose atlas this is. Several portraits are stacked and cross-fade by
 * `index`. Purely decorative: aria-hidden, never takes pointer events.
 */
export default function PortraitBackdrop({
  portraits,
  index,
  strength = 1,
}: {
  portraits: Portrait[];
  index: number;
  /** Multiplier on the resting opacity (the intro turns it up). */
  strength?: number;
}) {
  if (portraits.length === 0) return null;
  const active = index % portraits.length;
  return (
    <div className="atlas-backdrop" aria-hidden="true" style={{ "--strength": strength } as React.CSSProperties}>
      {portraits.map((portrait, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- decorative, pre-sized static file
        <img
          key={portrait.file}
          src={BASE_PATH + portrait.file}
          alt=""
          width={portrait.width}
          height={portrait.height}
          decoding="async"
          data-active={i === active}
          style={{ objectPosition: FOCUS[portrait.file.split("/").pop() ?? ""] ?? "50% 35%" }}
        />
      ))}
    </div>
  );
}
