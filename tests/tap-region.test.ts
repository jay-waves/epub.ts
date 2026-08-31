import assert from "node:assert/strict";
import test from "node:test";

import { getReaderTapRegion } from "../app/reader/tap-region.ts";

test("reader taps use three full-width regions", () => {
  assert.equal(getReaderTapRegion(0, 900), "left");
  assert.equal(getReaderTapRegion(299, 900), "left");
  assert.equal(getReaderTapRegion(300, 900), "center");
  assert.equal(getReaderTapRegion(600, 900), "center");
  assert.equal(getReaderTapRegion(601, 900), "right");
  assert.equal(getReaderTapRegion(900, 900), "right");
});

test("reader taps outside a valid viewport are ignored", () => {
  assert.equal(getReaderTapRegion(-1, 900), null);
  assert.equal(getReaderTapRegion(901, 900), null);
  assert.equal(getReaderTapRegion(0, 0), null);
});
