import assert from "node:assert/strict";
import test from "node:test";
import { focusReaderAfterAction } from "../app/reader/ui/reader-focus.ts";

test("reader focus respects overlays and newer interactions after an async action", (t) => {
  let frame: FrameRequestCallback = () => {};
  let focused = 0;
  let overlay = false;
  let disabled = false;
  const button = { isConnected: true, matches: (selector: string) => selector === ":disabled" && disabled };
  const body = { matches: () => false };
  const input = { matches: () => true };
  const doc = {
    activeElement: button as typeof button | typeof body,
    body,
    querySelector: () => overlay ? {} : null,
    getElementById: () => ({ focus: (options: FocusOptions) => {
      assert.equal(options.preventScroll, true);
      focused++;
    } }),
  };
  const originals = new Map(["requestAnimationFrame", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => { frame = callback; return 1; } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  const source = button as unknown as Element;

  focusReaderAfterAction(source);
  assert.equal(focused, 0);
  frame(0);
  assert.equal(focused, 1);

  focusReaderAfterAction(source);
  overlay = true;
  frame(0);
  assert.equal(focused, 1);
  overlay = false;

  focusReaderAfterAction(source);
  doc.activeElement = input;
  frame(0);
  assert.equal(focused, 1);

  focusReaderAfterAction();
  frame(0);
  assert.equal(focused, 1);

  // Saving can disable its button and cause the browser to move focus to body.
  disabled = true;
  doc.activeElement = body;
  focusReaderAfterAction(source);
  frame(0);
  assert.equal(focused, 2);
  disabled = false;

  // Closing search removes its focused control; body focus is safe to restore.
  button.isConnected = false;
  doc.activeElement = body;
  focusReaderAfterAction(source);
  frame(0);
  assert.equal(focused, 3);

  // An unmounted source must not steal focus from another control.
  doc.activeElement = { matches: () => false };
  focusReaderAfterAction(source);
  frame(0);
  assert.equal(focused, 3);
});
