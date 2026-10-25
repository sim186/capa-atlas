type WebGLProbeCanvas = {
  getContext(
    contextId: string,
    options: WebGLContextAttributes
  ): unknown;
};

type WebGLProbeContext = {
  getExtension?: (name: string) => { loseContext?: () => void } | null;
};

/**
 * Check the exact WebGL generation required by current Three.js before the
 * expensive graph component mounts. The probe context is released immediately
 * so it does not consume one of the browser's limited GPU contexts.
 */
export function detectWebGL2(canvas: WebGLProbeCanvas): boolean {
  try {
    const context = canvas.getContext("webgl2", {
      antialias: false,
      failIfMajorPerformanceCaveat: true,
      powerPreference: "high-performance",
    }) as WebGLProbeContext | null;
    if (!context) return false;

    context.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

type FrameScheduler = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
};

/**
 * Coalesce work onto the next paint. In particular, 3d-force-graph's
 * resumeAnimation() ticks synchronously, so calling it during a React update
 * can race the library before its force layout exists.
 */
export function makeDeferredFrame(scheduler: FrameScheduler, callback: () => void) {
  let pending: number | null = null;

  return {
    schedule() {
      if (pending !== null) return;
      pending = scheduler.request(() => {
        pending = null;
        callback();
      });
    },
    cancel() {
      if (pending === null) return;
      scheduler.cancel(pending);
      pending = null;
    },
  };
}
