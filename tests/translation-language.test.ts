import assert from "node:assert/strict";
import test from "node:test";

import { translationModelLanguage } from "../app/reader/context-menu/translation-language.ts";

test("preserves normalized Chinese locale tags for the translation model", () => {
  for (const [language, expected] of [
    ["zh", "zh"],
    ["zh-CN", "zh-cn"],
    ["zh-TW", "zh-tw"],
    ["zh-Hans", "zh-hans"],
    ["zh-Hant", "zh-hant"],
    ["zh-HK", "zh-hk"],
  ]) {
    assert.equal(translationModelLanguage(language), expected);
  }
  assert.equal(translationModelLanguage("ja-JP"), "ja-jp");
  assert.equal(translationModelLanguage("EN-us"), "en-us");
});
