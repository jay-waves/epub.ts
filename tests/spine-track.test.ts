import assert from "node:assert/strict";
import test from "node:test";

import { PaginatedTrack } from "../app/renderer/paginated/paginated-track.ts";
import { ScrolledTrack } from "../app/renderer/scrolled/scrolled-track.ts";

const entry = (index: number, contentColumns = 1) => ({
  index,
  start: 0,
  extent: contentColumns * 500,
  view: {
    columnCount: 3,
    columnStep: 500,
    contentColumns,
    extent: contentColumns * 500,
  },
});

test("keeps ordinary spine sections in one continuous column stream", () => {
  const track = new PaginatedTrack(() => 1_500);
  const entries = [entry(0), entry(1), entry(2)];
  const placements = track.layout(entries).placements;

  assert.deepEqual(placements.map(({ physicalStart }) => physicalStart),
    [1_500, 2_000, 2_500]);
});

test("preserves the local viewport position when a preceding section is removed", () => {
  const track = new PaginatedTrack(() => 1_500);
  const previous = entry(0, 4);
  const current = entry(1, 20);
  track.layout([previous, current]);
  const oldEntryOffset = track.entryOffset(current);
  const oldViewportOffset = oldEntryOffset + 3_000;

  track.updateForChange({ added: [], removed: [previous] }, current.index);
  track.layout([current]);
  const newEntryOffset = track.entryOffset(current);
  const restoredViewportOffset = oldViewportOffset + newEntryOffset - oldEntryOffset;

  assert.equal(restoredViewportOffset - newEntryOffset, 3_000);
});

test("scrolled track remains a direct vertical extent", () => {
  const track = new ScrolledTrack(() => 800);
  const entries = [entry(0, 2), entry(1, 3)];
  const placements = track.layout(entries).placements;

  assert.deepEqual(placements.map(({ physicalStart }) => physicalStart), [0, 1_000]);
  assert.equal(track.contentExtent, 2_500);
  assert.equal(track.physicalExtent, 3_300);
});
