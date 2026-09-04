import assert from "node:assert/strict";
import test from "node:test";

import { observeSettledResize } from "../app/renderer/shared/settled-resize.ts";

class FakeResizeObserver {
  static current: FakeResizeObserver;
  readonly #callback: ResizeObserverCallback;
  disconnected = false;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    FakeResizeObserver.current = this;
  }

  disconnect() { this.disconnected = true; }
  observe() {}
  unobserve() {}
  trigger() { this.#callback([], this as unknown as ResizeObserver); }
}

test("settled resize coalesces a burst and cancels pending work", async () => {
  const previousWindow = globalThis.window;
  const previousObserver = globalThis.ResizeObserver;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { clearTimeout, setTimeout },
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: FakeResizeObserver,
  });

  try {
    let calls = 0;
    const stop = observeSettledResize({} as Element, () => { calls += 1; }, 5);
    FakeResizeObserver.current.trigger();
    FakeResizeObserver.current.trigger();
    FakeResizeObserver.current.trigger();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(calls, 1);

    FakeResizeObserver.current.trigger();
    stop();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(calls, 1);
    assert.equal(FakeResizeObserver.current.disconnected, true);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: previousObserver,
    });
  }
});
