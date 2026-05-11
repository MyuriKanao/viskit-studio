import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * AC#6 (spec §R7): under React 18 `<StrictMode>` double-mount, the fabric.js
 * `Canvas` constructor must be invoked **exactly once**, and `dispose()` must
 * be invoked **exactly once** on final unmount.
 *
 * The locked behavior in §R7 (the mount-guard ref in `CanvasStage`) keeps the
 * second StrictMode mount from re-constructing because the ref persists
 * across the synthetic double-effect. We assert the final-state contract:
 *   - constructor call count === 1
 *   - dispose call count === 1
 */

// Use `vi.hoisted` so the mock factory (which vitest hoists above imports)
// can reach our spy mocks without a ReferenceError.
const { CanvasMock, DisposeMock } = vi.hoisted(() => {
  const disposeMock = vi.fn();
  const canvasMock = vi.fn().mockImplementation(() => ({
    dispose: disposeMock,
    on: vi.fn(),
    off: vi.fn(),
    toObject: vi.fn(() => ({})),
    toJSON: vi.fn(() => ({})),
    requestRenderAll: vi.fn(),
    // backgroundImage setter/getter stub
    backgroundImage: null,
  }));
  return { CanvasMock: canvasMock, DisposeMock: disposeMock };
});

vi.mock('fabric', () => ({
  Canvas: CanvasMock,
  FabricImage: {
    fromURL: vi.fn(() => Promise.resolve({})),
  },
}));

// Import AFTER the mock so the component receives the mocked module.
import { CanvasStage } from '@/components/editor/CanvasStage';

afterEach(() => {
  // Order matters: `cleanup()` unmounts the components left over from the
  // previous test (which fires `dispose()` via the CanvasStage useEffect
  // cleanup). Clearing the mocks BEFORE cleanup would let that final dispose
  // leak into the next test's counter. Clear AFTER cleanup.
  cleanup();
  CanvasMock.mockClear();
  DisposeMock.mockClear();
});

describe('CanvasStage — StrictMode lifecycle (AC#6, spec §R7)', () => {
  it('constructs fabric.Canvas exactly once under <React.StrictMode>', async () => {
    render(
      <React.StrictMode>
        <CanvasStage
          imageId="test-1"
          imageUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        />
      </React.StrictMode>
    );

    // CanvasStage defers `new fabric.Canvas(...)` to the next animation
    // frame so that the synthetic StrictMode cleanup can cancel the
    // first-mount construction. Wait for the rAF to flush before asserting.
    await waitFor(() => {
      expect(CanvasMock).toHaveBeenCalledTimes(1);
    });
  });

  it('disposes the fabric.Canvas exactly once on unmount', async () => {
    const { unmount } = render(
      <React.StrictMode>
        <CanvasStage
          imageId="test-2"
          imageUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        />
      </React.StrictMode>
    );

    // Wait for the deferred fabric construction to finish before unmounting,
    // otherwise the cleanup would short-circuit (nothing to dispose).
    await waitFor(() => {
      expect(CanvasMock).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(DisposeMock).toHaveBeenCalledTimes(1);
  });
});
