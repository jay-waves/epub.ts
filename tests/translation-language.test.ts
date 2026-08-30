import assert from "node:assert/strict";
import test from "node:test";

import { translationModelLanguage } from "../app/reader/context-menu/translation-language.ts";

test("routes every Chinese locale through Edge's usable lzh model", () => {
  for (const language of ["zh", "zh-CN", "zh-TW", "zh-Hans", "zh-Hant", "zh-HK"]) {
    assert.equal(translationModelLanguage(language), "lzh");
  }
  assert.equal(translationModelLanguage("ja-JP"), "ja-jp");
  assert.equal(translationModelLanguage("EN-us"), "en-us");
});
