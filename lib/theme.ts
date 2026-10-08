import type { Group } from "./graph";

/**
 * The whole UI is tinted from one theme object at a time. "mono" is the
 * quiet ink-on-paper default; picking a node while colorize is on retints
 * every surface (page, panel, graph background, links) to its category.
 * Everything is flat: solid fills, hairlines, no gradients or glows.
 */
export interface AtlasTheme {
  bg: string;
  ink: string;
  node: string;
  line: string;
  lineHi: string;
}

export const MONO_THEME: AtlasTheme = {
  bg: "#ececec",
  ink: "#171717",
  node: "#1c1c1c",
  line: "rgba(23, 23, 23, 0.10)",
  lineHi: "rgba(23, 23, 23, 0.42)",
};

// Each theme is the colour the node already wears on the map (GROUP_COLOR in
// lib/graph.ts): pick a pink disc and the whole page goes pink, not red.
export const CATEGORY_THEMES: Record<Group, AtlasTheme> = {
  album: {
    bg: "#1b2a7a",
    ink: "#eceffe",
    node: "#9fb0f5",
    line: "rgba(159, 176, 245, 0.16)",
    lineHi: "rgba(159, 176, 245, 0.55)",
  },
  song: {
    bg: "#073f40",
    ink: "#e6f6f5",
    node: "#7fd1cc",
    line: "rgba(127, 209, 204, 0.16)",
    lineHi: "rgba(127, 209, 204, 0.55)",
  },
  figure: {
    bg: "#6e1240",
    ink: "#fdebf3",
    node: "#f59cc4",
    line: "rgba(245, 156, 196, 0.16)",
    lineHi: "rgba(245, 156, 196, 0.55)",
  },
  concept: {
    bg: "#6a2a07",
    ink: "#fdf0e7",
    node: "#f6ad7c",
    line: "rgba(246, 173, 124, 0.16)",
    lineHi: "rgba(246, 173, 124, 0.55)",
  },
};

/** Set --atlas-* custom properties on a container so plain CSS can follow the theme. */
export function themeVars(theme: AtlasTheme): React.CSSProperties {
  return {
    "--atlas-bg": theme.bg,
    "--atlas-ink": theme.ink,
    "--atlas-node": theme.node,
    "--atlas-hair": "color-mix(in oklch, currentColor 16%, transparent)",
  } as React.CSSProperties;
}
