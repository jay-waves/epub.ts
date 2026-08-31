import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTocHref } from "../app/epub/metadata.ts";

test("normalizes valid TOC URLs and preserves invalid values", () => {
  assert.equal(normalizeTocHref("chapters/one.xhtml?view=1#start"), "/chapters/one.xhtml#start");
  assert.equal(normalizeTocHref("  http://[  "), "http://[");
});
