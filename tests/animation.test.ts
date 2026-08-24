import assert from "node:assert/strict";
import test from "node:test";

import { animateNumber } from "../app/renderer/shared/animation.ts";
import { ScrollCoordinator } from "../app/renderer/scrolled/scroll-coordinator.ts";

type FrameCallback = (time: number) => void;

function installAnimationEnvironment() {
  const originalDocument = globalThis.document;
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map<number, FrameCallback>();
  let nextFrame = 1;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  globalThis.requestAnimationFrame = ((callback: FrameCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    frames.delete(id);
  }) as typeof cancelAnimationFrame;

  return {
    flush(time: number) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    },
    pending: () => frames.size,
    restore() {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}

test("cancelled animation does not render or report completion", async () => {
  const environment = installAnimationEnvironment();
  try {
    const controller = new AbortController();
    const values: number[] = [];
    const result = animateNumber(0, 100, 300, value => value,
      value => values.push(value), controller.signal);

    assert.equal(environment.pending(), 1);
    controller.abort();
    assert.equal(await result, false);
    assert.equal(environment.pending(), 0);
    assert.deepEqual(values, []);
  } finally {
    environment.restore();
  }
});

test("completed animation reports success and lands exactly at its target", async () => {
  const environment = installAnimationEnvironment();
  try {
    const values: number[] = [];
    const result = animateNumber(0, 100, 100, value => value,
      value => values.push(value));

    environment.flush(10);
    environment.flush(110);
    assert.equal(await result, true);
    assert.equal(values.at(-1), 100);
    assert.equal(environment.pending(), 0);
  } finally {
    environment.restore();
  }
});

test("programmatic scrolling suppresses its delayed scrollend commit", () => {
  const environment = installAnimationEnvironment();
  try {
    const container = new EventTarget() as HTMLElement;
    let updates = 0;
    const coordinator = new ScrollCoordinator(container, () => updates += 1);

    coordinator.schedule();
    coordinator.cancel(true);
    container.dispatchEvent(new Event("scrollend"));
    assert.equal(updates, 0);

    // A subsequent user scroll schedules an update and clears the suppression.
    coordinator.schedule();
    container.dispatchEvent(new Event("scrollend"));
    assert.equal(updates, 1);
    coordinator.destroy();
  } finally {
    environment.restore();
  }
});
