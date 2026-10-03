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
// lib/graph.ts): pick a violet disc and the whole page goes violet, not blue.
export const CATEGORY_THEMES: Record<Group, AtlasTheme> = {
  album: {
    bg: "#2e00aa",
    ink: "#ece8ff",
    node: "#a88bd0",
    line: "rgba(168, 139, 208, 0.16)",
    lineHi: "rgba(168, 139, 208, 0.55)",
  },
  song: {
    bg: "#0b3d67",
    ink: "#eaf3fb",
    node: "#7fb8ea",
    line: "rgba(127, 184, 234, 0.16)",
    lineHi: "rgba(127, 184, 234, 0.55)",
  },
  figure: {
    bg: "#6b1414",
    ink: "#fdeceb",
    node: "#f19a97",
    line: "rgba(241, 154, 151, 0.16)",
    lineHi: "rgba(241, 154, 151, 0.55)",
  },
  concept: {
    bg: "#0f4a30",
    ink: "#e9f7ee",
    node: "#8fd6ab",
    line: "rgba(143, 214, 171, 0.16)",
    lineHi: "rgba(143, 214, 171, 0.55)",
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
