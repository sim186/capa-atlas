import { GROUP_COLOR, GROUP_SHAPE, GROUP_SHAPE_DISTINCT, type Group } from "@/lib/graph";

/** Tiny category marker: same silhouette and colour as the node on canvas. */
export default function GroupGlyph({
  group,
  size = 14,
  color,
  distinct = false,
}: {
  group: Group;
  size?: number;
  color?: string;
  /** Use the distinct silhouettes (accessibility option) instead of discs. */
  distinct?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden
      className="shrink-0"
    >
      <path d={(distinct ? GROUP_SHAPE_DISTINCT : GROUP_SHAPE)[group]} fill={color ?? GROUP_COLOR[group]} />
    </svg>
  );
}
