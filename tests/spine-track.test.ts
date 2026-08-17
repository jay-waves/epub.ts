import assert from "node:assert/strict";
import test from "node:test";

import { SpineTrack } from "../app/renderer/shared/spine-track.ts";

type View = {
  columnCount: number;
  columnStep: number;
  contentColumns: number;
  extent: number;
  packingBlockExtent: number;
  packingBlockSize: number;
};

const entry = (index: number, blockExtent: number, contentColumns = 1) => ({
  index,
  start: 0,
  extent: contentColumns * 500,
  view: {
    columnCount: 2,
    columnStep: 500,
    contentColumns,
    extent: contentColumns * 500,
    packingBlockExtent: blockExtent,
    packingBlockSize: 800,
  } satisfies View,
});

const projection = { kind: "paginated", viewportSize: 1_000 } as const;
const packing = { canPack: () => true, packingGap: 40 };

test("packs complete short chapters into one physical column", () => {
  const track = new SpineTrack<View>();
  const entries = [entry(0, 200), entry(1, 200), entry(2, 200)];
  const { placements } = track.layout(entries, projection, packing);

  assert.deepEqual(placements.map(({ physicalStart, blockStart }) =>
    [physicalStart, blockStart]), [
    [1_000, 0],
    [1_000, 240],
    [1_000, 480],
  ]);
  assert.deepEqual(placements.map(({ clipBlockExtent }) => clipBlockExtent),
    [200, 200, 200]);
  assert.equal(track.contentExtent, 500);
});

test("starts a new column when the complete next chapter does not fit", () => {
  const track = new SpineTrack<View>();
  const entries = [entry(0, 200), entry(1, 200), entry(2, 400)];
  const { placements } = track.layout(entries, projection, packing);

  assert.deepEqual(placements.map(({ physicalStart, blockStart }) =>
    [physicalStart, blockStart]), [
    [1_000, 0],
    [1_000, 240],
    [1_500, 0],
  ]);
  assert.equal(placements[2]?.clipBlockExtent, undefined);
  assert.equal(track.contentExtent, 1_000);
});

test("does not pack across an ineligible boundary or on a one-column viewport", () => {
  const entries = [entry(0, 200), entry(1, 200)];
  const track = new SpineTrack<View>();
  let placements = track.layout(entries, projection, {
    canPack: () => false,
    packingGap: 40,
  }).placements;
  assert.deepEqual(placements.map(({ physicalStart }) => physicalStart),
    [1_000, 1_500]);

  for (const item of entries) item.view.columnCount = 1;
  placements = track.layout(entries,
    { kind: "paginated", viewportSize: 500 }, packing).placements;
  assert.deepEqual(placements.map(({ physicalStart }) => physicalStart),
    [500, 1_000]);
});

test("keeps an existing target stable when a later chapter fills its column", () => {
  const track = new SpineTrack<View>();
  const first = entry(0, 200);
  const target = entry(1, 200);
  const later = entry(2, 200);
  const initial = track.layout([first, target], projection, packing).placements;
  const targetPosition = initial[1];

  const expanded = track.layout([first, target, later], projection, packing).placements;
  assert.equal(expanded[1]?.physicalStart, targetPosition?.physicalStart);
  assert.equal(expanded[1]?.blockStart, targetPosition?.blockStart);
  assert.equal(track.entryAt([first, target, later], 0, target), target);
  assert.equal(track.entryAt([first, target, later], 0), first);
});

test("a multi-column chapter closes the vertical packing slot", () => {
  const track = new SpineTrack<View>();
  const entries = [entry(0, 200, 2), entry(1, 200)];
  const { placements } = track.layout(entries, projection, packing);

  assert.deepEqual(placements.map(({ physicalStart, blockStart }) =>
    [physicalStart, blockStart]), [
    [1_000, 0],
    [2_000, 0],
  ]);
});

test("realigns a retained target from actual packed width after prepending", () => {
  const track = new SpineTrack<View>();
  const target = entry(3, 200);
  track.layout([target], projection, packing);
  const previousOffset = track.entryOffset(target, projection);
  const leading = entry(0, 200);
  const packed = entry(1, 200);
  const groupedPacking = {
    canPack: (_leading: typeof target, trailing: typeof target) => trailing.index !== 3,
    packingGap: 40,
  };

  track.layout([leading, packed, target], projection, groupedPacking);
  assert.equal(track.entryOffset(target, projection), 1_500);
  assert.equal(track.alignEntry(target, previousOffset, projection), true);
  track.layout([leading, packed, target], projection, groupedPacking);

  assert.equal(track.entryOffset(target, projection), 2_000);
  assert.equal(track.entryOffset(target, projection) % projection.viewportSize,
    previousOffset % projection.viewportSize);
});
