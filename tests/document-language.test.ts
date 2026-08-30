import assert from "node:assert/strict";
import test from "node:test";

import type { Book } from "../app/renderer";
import { detectDocumentLanguage } from "../app/reader/context-menu/document-language.ts";

test("detects one language from evenly sampled publication sections", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "LanguageDetector");
  let detectedText = "";
  let destroyed = false;
  Object.defineProperty(globalThis, "LanguageDetector", {
    configurable: true,
    value: {
      availability: async () => "available",
      create: async () => ({
        destroy: () => destroyed = true,
        detect: async (text: string) => {
          detectedText = text;
          return [{ confidence: 0.9, detectedLanguage: "fr" }];
        },
      }),
    },
  });

  try {
    const book = {
      sections: Array.from({ length: 9 }, (_, index) => ({
        createDocument: async () => ({
          body: { textContent: `section-${index} texte` },
        } as unknown as Document),
      })),
    } as Book;
    const language = await detectDocumentLanguage(book, new AbortController().signal);

    assert.equal(language, "fr");
    assert.match(detectedText, /section-0/u);
    assert.match(detectedText, /section-4/u);
    assert.match(detectedText, /section-8/u);
    assert.equal(detectedText.includes("section-1"), false);
    assert.equal(destroyed, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "LanguageDetector", previous);
    else Reflect.deleteProperty(globalThis, "LanguageDetector");
  }
});

test("falls back to publication metadata when detection is unavailable", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "LanguageDetector");
  Reflect.deleteProperty(globalThis, "LanguageDetector");
  try {
    const book = { metadata: { language: ["de-DE"] }, sections: [] } as Book;
    assert.equal(
      await detectDocumentLanguage(book, new AbortController().signal),
      "de-DE",
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "LanguageDetector", previous);
  }
});
