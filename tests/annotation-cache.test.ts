import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationCache } from "../app/renderer/shared/annotation-cache.ts";

type Annotation = {
  note?: string;
  value: string;
};

test("annotation cache survives overlay replacement and keeps updates", () => {
  const cache = new AnnotationCache<Annotation>();
  cache.set(2, { value: "epubcfi(/6/6)", note: "first" });

  assert.deepEqual(cache.forSection(2), [
    { value: "epubcfi(/6/6)", note: "first" },
  ]);

  cache.set(2, { value: "epubcfi(/6/6)", note: "updated" });
  assert.deepEqual(cache.forSection(2), [
    { value: "epubcfi(/6/6)", note: "updated" },
  ]);
});

test("annotation cache removes annotations independently of an active overlay", () => {
  const cache = new AnnotationCache<Annotation>();
  cache.set(1, { value: "epubcfi(/6/4)" });
  cache.set(3, { value: "epubcfi(/6/8)" });

  assert.equal(cache.indexOf("epubcfi(/6/4)"), 1);
  assert.equal(cache.delete("epubcfi(/6/4)"), true);
  assert.deepEqual(cache.forSection(1), []);
  assert.deepEqual(cache.forSection(3), [{ value: "epubcfi(/6/8)" }]);
});
