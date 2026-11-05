import assert from "node:assert/strict";
import test from "node:test";
import { SpineBuffer } from "../app/renderer/shared/spine-state.ts";

test("clearing the buffer rejects and disposes a late load", async () => {
  const pending = Promise.withResolvers<{ extent: number }>();
  const disposed: number[] = [];
  const buffer = new SpineBuffer({
    create: () => pending.promise,
    destroy: index => { disposed.push(index); },
    getExtent: view => view.extent,
  });
  const loading = buffer.prepare(2);
  buffer.clear();
  pending.resolve({ extent: 100 });
  await assert.rejects(loading, (error: DOMException) => error.name === "AbortError");
  assert.deepEqual(buffer.entries, []);
  assert.deepEqual(disposed, [2]);
});

test("a stale change cannot partially remove committed sections", async () => {
  const buffer = new SpineBuffer({
    create: async () => ({ extent: 100 }),
    destroy: () => {},
    getExtent: view => view.extent,
  });
  const first = await buffer.prepare(0);
  buffer.commit(buffer.changeFor([first]));
  const next = await buffer.prepare(1);
  const stale = { ...buffer.changeFor([next]), removed: [first] };
  buffer.commit(buffer.changeFor([next]));
  assert.throws(() => buffer.commit(stale), (error: DOMException) => error.name === "AbortError");
  assert.deepEqual(buffer.entries.map(entry => entry.index), [0, 1]);
});

test("concurrent requests share one staged section until commit", async () => {
  let loads = 0;
  const buffer = new SpineBuffer({
    create: async () => { loads += 1; return { extent: 100 }; },
    destroy: () => {},
    getExtent: view => view.extent,
  });
  const [a, b] = await Promise.all([buffer.prepare(0), buffer.prepare(0)]);
  assert.equal(a, b);
  assert.equal(loads, 1);
  assert.equal(buffer.entries.length, 0);
  buffer.commit(buffer.changeFor([a]));
  assert.equal(await buffer.prepare(0), a);
});
