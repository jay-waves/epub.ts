import assert from "node:assert/strict";
import test from "node:test";

import { buildLlmPrompt } from "../app/reader/context-menu/llm-prompt.ts";

test("places selected text after the reusable instruction prefix", () => {
  assert.equal(buildLlmPrompt("Translate to Chinese.\n\n{{selectedText}}", "Hello"), "Translate to Chinese.\n\nHello");
  assert.equal(buildLlmPrompt("Translate to Chinese.\n\n%s", "Hello"), "Translate to Chinese.\n\nHello");
  assert.equal(buildLlmPrompt("Translate to Chinese.", "Hello"), "Translate to Chinese.\n\nHello");
});
