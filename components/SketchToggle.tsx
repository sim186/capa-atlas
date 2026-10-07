"use client";

import { useEffect, useId, type ComponentProps } from "react";
import { DrawablyButton } from "drawably/react";

/**
 * A DrawablyButton whose variant or tone can change in place. drawably's
 * destroy() leaves the old `drawably-button--<variant>` class on the element,
 * so a button that went solid → outline kept its solid fill. These used to be
 * remounted with a `key` instead, which threw keyboard focus to <body> on
 * every toggle. This keeps the element and drops the stale classes.
 */
export default function SketchToggle(props: ComponentProps<typeof DrawablyButton>) {
  const id = useId();
  const { variant = "outline", tone } = props;
  // Runs after DrawablyButton's own effect has re-attached the sketch.
  useEffect(() => {
    const el = document.querySelector(`[data-sketch-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const keep = new Set([`drawably-button--${variant}`, `drawably-button--${tone}`]);
    for (const cls of [...el.classList]) {
      if (cls.startsWith("drawably-button--") && !keep.has(cls)) el.classList.remove(cls);
    }
  }, [id, variant, tone]);
  return <DrawablyButton {...props} data-sketch-id={id} />;
}
