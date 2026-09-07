import assert from "node:assert/strict";
import test from "node:test";
import { WheelGestures } from "wheel-gestures";
import { WheelInputSession } from "../app/reader/wheel-input-session.ts";
import { OverlayInput } from "../app/reader/overlay-input.ts";

test("a trackpad contextmenu cancels a swipe recognized before React mounts", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = new WheelInputSession();
  const overlay = new OverlayInput();
  overlay.subscribe(() => session.cancel());
  let turns = 0;
  session.start();
  session.queueTurn(() => turns++);
  t.mock.timers.tick(50);
  overlay.capture(new Event("contextmenu"));
  t.mock.timers.tick(200);
  assert.equal(turns, 0);
  assert.equal(session.cancelled, true);
});

test("closing a menu does not revive its interrupted wheel stream", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = new WheelInputSession();
  const overlay = new OverlayInput();
  overlay.subscribe(() => session.cancel());
  let turns = 0;
  session.start();
  const release = overlay.register({ contains: () => true, dismiss() {} });
  release();
  assert.equal(overlay.locked, false);
  session.queueTurn(() => turns++);
  t.mock.timers.tick(200);
  assert.equal(turns, 0);
  session.end();
  session.start();
  session.queueTurn(() => turns++);
  t.mock.timers.tick(150);
  assert.equal(turns, 1);
});

test("normal swipes commit once, including after the recognizer ends", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = new WheelInputSession();
  let turns = 0;
  session.start();
  session.queueTurn(() => turns++);
  session.queueTurn(() => turns++);
  session.end();
  t.mock.timers.tick(149);
  assert.equal(turns, 0);
  t.mock.timers.tick(1);
  assert.equal(turns, 1);
});

test("contextmenu cancels pending turns even after the wheel stream ends", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = new WheelInputSession();
  let turns = 0;
  session.start();
  session.queueTurn(() => turns++);
  session.end();
  session.cancel();
  t.mock.timers.tick(200);
  assert.equal(turns, 0);
});

test("feeding blocked wheel events keeps the recognizer alive until the actual pause", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wheel = WheelGestures({ preventWheelAction: false });
  const session = new WheelInputSession();
  const overlay = new OverlayInput();
  overlay.subscribe(() => session.cancel());
  let starts = 0;
  let endings = 0;
  wheel.on("wheel", (state) => {
    if (state.isStart) { starts++; session.start(); }
    if (state.isEnding) { endings++; session.end(); return; }
    if (overlay.locked) session.cancel();
  });
  const feed = (timeStamp: number) => wheel.feedWheel({
    deltaMode: 0, deltaX: 15, deltaY: 0, timeStamp,
  });
  feed(0);
  const release = overlay.register({ contains: () => false, dismiss() {} });
  for (let time = 20; time <= 200; time += 20) {
    t.mock.timers.tick(20);
    feed(time);
  }
  release();
  feed(220);
  assert.equal(starts, 1);
  assert.equal(endings, 0);
  assert.equal(session.cancelled, true);
  t.mock.timers.tick(1100);
  assert.equal(endings, 1);
  feed(1400);
  assert.equal(starts, 2);
  assert.equal(session.cancelled, false);
  t.mock.timers.tick(1100);
  wheel.disconnect();
});
