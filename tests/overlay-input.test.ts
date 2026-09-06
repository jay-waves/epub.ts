import assert from "node:assert/strict";
import test from "node:test";
import { OverlayInput } from "../app/reader/overlay-input.ts";

function fixture() {
  const input = new OverlayInput();
  const shell = new EventTarget();
  const iframe = new EventTarget();
  let pageTurns = 0;
  let dismissals = 0;
  const inside = new WeakSet<Event>();
  const release = input.register({
    contains: (event) => inside.has(event),
    dismiss: () => { dismissals++; release(); },
  });
  for (const target of [shell, iframe]) {
    for (const type of ["pointerdown", "pointerup", "pointercancel", "click", "wheel", "keydown"]) {
      target.addEventListener(type, input.capture);
      target.addEventListener(type, () => { pageTurns++; });
    }
  }
  const send = (target: EventTarget, type: string, internal = false) => {
    const event = new Event(type, { cancelable: true });
    if (internal) inside.add(event);
    target.dispatchEvent(event);
    return event;
  };
  return { input, shell, iframe, send, release,
    get pageTurns() { return pageTurns; },
    get dismissals() { return dismissals; },
  };
}

test("outside dismissal consumes the whole gesture in shell and iframe", () => {
  for (const realm of ["shell", "iframe"] as const) {
    const f = fixture();
    for (const type of ["pointerdown", "pointerup"]) {
      assert.equal(f.send(f[realm], type).defaultPrevented, true);
      assert.equal(f.input.locked, true);
      assert.equal(f.dismissals, 0);
    }
    f.send(f[realm], "click");
    assert.equal(f.dismissals, 1);
    assert.equal(f.pageTurns, 0);
    assert.equal(f.input.locked, false);
    f.send(f[realm], "pointerdown");
    f.send(f[realm], "click");
    assert.equal(f.pageTurns, 2);
  }
});

test("closing during a press cannot release its trailing click to the reader", () => {
  const f = fixture();
  f.send(f.iframe, "pointerdown");
  f.release();
  assert.equal(f.input.locked, true);
  f.send(f.iframe, "pointerup");
  f.send(f.iframe, "click");
  assert.equal(f.pageTurns, 0);
  assert.equal(f.input.locked, false);
});

test("outside wheel and keys are blocked while menu controls remain usable", () => {
  const f = fixture();
  f.send(f.iframe, "wheel");
  f.send(f.iframe, "keydown");
  assert.equal(f.pageTurns, 0);
  assert.equal(f.dismissals, 0);
  assert.equal(f.send(f.shell, "click", true).defaultPrevented, false);
  assert.equal(f.pageTurns, 1);
});

test("releasing one overlay does not unlock another; opening cancels pending input", () => {
  const input = new OverlayInput();
  let cancellations = 0;
  const unsubscribe = input.subscribe(() => cancellations++);
  const first = input.register({ contains: () => false, dismiss() {} });
  const second = input.register({ contains: () => false, dismiss() {} });
  assert.equal(cancellations, 2);
  first();
  assert.equal(input.locked, true);
  second();
  assert.equal(input.locked, false);
  unsubscribe();
});

test("Escape closes an overlay without reaching reader keyboard commands", () => {
  const f = fixture();
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { value: "Escape" });
  f.iframe.dispatchEvent(event);
  assert.equal(f.dismissals, 1);
  assert.equal(f.pageTurns, 0);
  assert.equal(f.input.locked, false);
});

test("pointer cancellation does not leave a lock after the overlay closes", () => {
  const f = fixture();
  f.send(f.iframe, "pointerdown");
  f.send(f.iframe, "pointercancel");
  f.release();
  assert.equal(f.input.locked, false);
});
