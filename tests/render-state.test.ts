import assert from "node:assert/strict";
import test from "node:test";

import { createRenderState } from "../app/reader/render.ts";

function createRoot() {
  const classes = new Set<string>();
  return {
    classes,
    root: {
      classList: {
        add: (...names: string[]) => names.forEach((name) => classes.add(name)),
        remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      },
    } as unknown as HTMLElement,
  };
}

test("one failed render cannot clear another render's pending state", async () => {
  const originalRequest = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  }) as typeof requestAnimationFrame;

  try {
    const { classes, root } = createRoot();
    const state = createRenderState(root);
    const pending = Promise.withResolvers<void>();
    const failed = state.run(() => Promise.reject(new Error("failed")));
    const active = state.run(() => pending.promise);

    await assert.rejects(failed, /failed/);
    assert.equal(state.isPending(), true);
    assert.equal(classes.has("reader-frame--pending"), true);

    pending.resolve();
    await active;
    assert.equal(state.isPending(), false);
    assert.equal(classes.has("reader-frame--pending"), false);
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
  }
});
