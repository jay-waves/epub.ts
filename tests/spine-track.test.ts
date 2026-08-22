import assert from "node:assert/strict";
import test from "node:test";

import { SpineTrack } from "../app/renderer/shared/spine-track.ts";

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

const projection = { kind: "paginated", viewportSize: 1_500 } as const;

test("keeps ordinary spine sections in one continuous column stream", () => {
  const track = new SpineTrack();
  const entries = [entry(0), entry(1), entry(2)];
  const placements = track.layout(entries, projection).placements;

  assert.deepEqual(placements.map(({ physicalStart }) => physicalStart),
    [1_500, 2_000, 2_500]);
});

test("preserves the local viewport position when a preceding section is removed", () => {
  const track = new SpineTrack();
  const previous = entry(0, 4);
  const current = entry(1, 20);
  track.layout([previous, current], projection);
  const oldEntryOffset = track.entryOffset(current, projection);
  const oldViewportOffset = oldEntryOffset + 3_000;

  track.updateForChange({ added: [], removed: [previous] }, current.index, projection);
  track.layout([current], projection);
  const newEntryOffset = track.entryOffset(current, projection);
  const restoredViewportOffset = oldViewportOffset + newEntryOffset - oldEntryOffset;

  assert.equal(restoredViewportOffset - newEntryOffset, 3_000);
});
