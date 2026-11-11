import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAnnotation } from "../app/epub/annotation.ts";

const annotation = { value: "epubcfi(/6/4)", color: "yellow", createdAt: 12 };

test("imported annotations validate optional fields and discard unknown data", () => {
  const result = normalizeAnnotation({
    ...annotation, text: 42, note: { value: "note" }, index: Infinity,
    fraction: "0.5", updatedAt: NaN, unexpected: "discard",
  });
  assert.deepEqual(result, {
    ...annotation, id: `legacy:12:${annotation.value}`, updatedAt: 12,
  });
  assert.equal(normalizeAnnotation({ ...annotation, color: 42 }), null);
  assert.equal(normalizeAnnotation({ ...annotation, createdAt: Infinity }), null);
});

test("valid annotations retain identity, text, position and revision timestamps", () => {
  const value = {
    ...annotation, id: "id", text: "text", note: "note", index: 0,
    fraction: 0, updatedAt: 25,
  };
  assert.deepEqual(normalizeAnnotation(value), value);
});
