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
