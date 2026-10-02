import { useSyncExternalStore } from "react";

/** Below this width the atlas switches to its phone layout. */
export const DESKTOP_QUERY = "(min-width: 800px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Desktop layout on the server and first paint; the client corrects it. */
export function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true
  );
}

/** Touch devices (phones, tablets) report a coarse primary pointer. */
export const TOUCH_QUERY = "(pointer: coarse)";

function subscribeTouch(onChange: () => void) {
  const mq = window.matchMedia(TOUCH_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Whether the primary input is touch. Width alone can't tell a tablet from a
 * desktop window, but their GPUs differ a lot: the atlas uses this (together
 * with the phone width) to pick its lighter rendering profile.
 */
export function useIsTouch() {
  return useSyncExternalStore(
    subscribeTouch,
    () => window.matchMedia(TOUCH_QUERY).matches,
    () => false
  );
}
