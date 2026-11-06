import assert from "node:assert/strict";
import test from "node:test";

import { buildLlmPrompt } from "../app/platform/ai-prompt.ts";

test("places selected text after the reusable instruction prefix", () => {
  assert.equal(buildLlmPrompt("Translate to Chinese.\n\n{{selectedText}}", "Hello"), "Translate to Chinese.\n\nHello");
  assert.equal(buildLlmPrompt("Translate to Chinese.\n\n%s", "Hello"), "Translate to Chinese.\n\nHello");
  assert.equal(buildLlmPrompt("Translate to Chinese.", "Hello"), "Translate to Chinese.\n\nHello");
});

test("selection replacement preserves literal dollar sequences and template-like content", () => {
  const text = "$& $` $' {{targetLanguage}}";
  assert.equal(buildLlmPrompt("Into {{targetLanguage}}: {{selectedText}}", text), `Into Chinese: ${text}`);
  assert.equal(buildLlmPrompt("Into {{targetLanguage}}: %s", text), `Into Chinese: ${text}`);
});
