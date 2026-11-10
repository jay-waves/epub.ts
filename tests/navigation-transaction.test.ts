import assert from "node:assert/strict";
import test from "node:test";

import { NavigationTransaction } from "../app/renderer/shared/navigation.ts";

test("queued navigation executes mixed moves serially", async () => {
  const navigation = new NavigationTransaction(() => undefined);
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstDone = new Promise<void>((resolve) => releaseFirst = resolve);

  const first = navigation.enqueue(async () => {
    order.push("page:start");
    await firstDone;
    order.push("page:end");
  });
  const second = navigation.enqueue(() => order.push("turn"));

  assert.equal(navigation.busy, true);
  await Promise.resolve();
  assert.deepEqual(order, ["page:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["page:start", "page:end", "turn"]);
  assert.equal(navigation.busy, false);
});

test("invalidating navigation drops queued work from the old revision", async () => {
  const navigation = new NavigationTransaction(() => undefined);
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => release = resolve);
  const first = navigation.enqueue(() => blocker);
  const stale = navigation.enqueueCurrent(() => "stale");

  navigation.invalidate();
  release();

  assert.equal(await first, undefined);
  assert.equal(await stale, undefined);
  assert.equal(await navigation.enqueueCurrent(() => "current"), "current");
});

test("queued navigation waits when deferred reflow acquires another transaction", async () => {
  let releaseFirst!: () => void;
  let releaseReflow!: () => void;
  const firstGate = new Promise<void>(resolve => releaseFirst = resolve);
  const reflowGate = new Promise<void>(resolve => releaseReflow = resolve);
  const order: string[] = [];
  const navigation = new NavigationTransaction(() => {
    void navigation.run(async () => {
      order.push("reflow:start");
      await reflowGate;
      order.push("reflow:end");
    });
  });
  const first = navigation.run(() => firstGate);
  navigation.deferReflow();
  const queued = navigation.enqueue(() => order.push("navigate"));
  await Promise.resolve();
  releaseFirst();
  await first;
  await Promise.resolve();
  assert.deepEqual(order, ["reflow:start"]);
  releaseReflow();
  await queued;
  assert.deepEqual(order, ["reflow:start", "reflow:end", "navigate"]);
});
