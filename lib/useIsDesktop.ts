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
