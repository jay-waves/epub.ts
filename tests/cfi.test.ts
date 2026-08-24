import assert from "node:assert/strict";
import test from "node:test";

import { joinIndir, parse } from "../app/epub/cfi.ts";

test("parses package and local CFI paths with typed step data", () => {
  assert.deepEqual(parse("epubcfi(/6/4[chap]!/4/2:12)"), [
    [{ index: 6 }, { id: "chap", index: 4 }],
    [{ index: 4 }, { index: 2, offset: 12 }],
  ]);
});

test("parses a CFI range into parent, start, and end paths", () => {
  assert.deepEqual(parse("epubcfi(/6/4!/4,/2:1,/2:5)"), {
    parent: [[{ index: 6 }, { index: 4 }], [{ index: 4 }]],
    start: [[{ index: 2, offset: 1 }]],
    end: [[{ index: 2, offset: 5 }]],
  });
});

test("joins wrapped CFIs without retaining nested wrappers", () => {
  assert.equal(
    joinIndir("epubcfi(/6/4)", "epubcfi(/4/2:12)"),
    "epubcfi(/6/4!/4/2:12)",
  );
});
