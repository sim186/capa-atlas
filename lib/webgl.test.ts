import { describe, expect, it, vi } from "vitest";
import { detectWebGL2, makeDeferredFrame } from "./webgl";

describe("detectWebGL2", () => {
  it("reports unavailable without mounting the 3D graph when context creation fails", () => {
    const canvas = {
      getContext: vi.fn(() => null),
    };

    expect(detectWebGL2(canvas)).toBe(false);
    expect(canvas.getContext).toHaveBeenCalledWith("webgl2", {
      antialias: false,
      failIfMajorPerformanceCaveat: true,
      powerPreference: "high-performance",
    });
  });

  it("releases a successful probe context", () => {
    const loseContext = vi.fn();
    const canvas = {
      getContext: vi.fn(() => ({
        getExtension: vi.fn(() => ({ loseContext })),
      })),
    };

    expect(detectWebGL2(canvas)).toBe(true);
    expect(loseContext).toHaveBeenCalledOnce();
  });
});

describe("makeDeferredFrame", () => {
  it("defers and coalesces graph animation resumes", () => {
    let queued: FrameRequestCallback | undefined;
    const request = vi.fn((callback: FrameRequestCallback) => {
      queued = callback;
      return 7;
    });
    const cancel = vi.fn();
    const resume = vi.fn();
    const frame = makeDeferredFrame({ request, cancel }, resume);

    frame.schedule();
    frame.schedule();

    expect(resume).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();

    queued?.(16);
    expect(resume).toHaveBeenCalledOnce();
  });

  it("cancels a pending resume when the scene unmounts", () => {
    const request = vi.fn(() => 11);
    const cancel = vi.fn();
    const frame = makeDeferredFrame({ request, cancel }, vi.fn());

    frame.schedule();
    frame.cancel();

    expect(cancel).toHaveBeenCalledWith(11);
  });
});
