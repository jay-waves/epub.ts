import assert from "node:assert/strict";
import test from "node:test";

import { NavigationTransaction } from "../app/renderer/shared/navigation-transaction.ts";

test("queued navigation executes mixed moves serially", async () => {
  const navigation = new NavigationTransaction();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstDone = new Promise<void>((resolve) => releaseFirst = resolve);

  const first = navigation.enqueue(async () => {
    order.push("page:start");
    await firstDone;
    order.push("page:end");
  }, () => undefined);
  const second = navigation.enqueue(() => order.push("turn"), () => undefined);

  assert.equal(navigation.busy, true);
  await Promise.resolve();
  assert.deepEqual(order, ["page:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["page:start", "page:end", "turn"]);
  assert.equal(navigation.busy, false);
});
