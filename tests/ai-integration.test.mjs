import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.includes('/app/')) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
const { createAdvancedSettingsController } = await import('../app/reader/advanced-settings.ts');
const { createTextContext } = await import('../app/reader/context-menu/text-context.ts');
const { AI_STORAGE_KEY } = await import('../app/platform/browser-ai.ts');
hooks.deregister();

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('reader migration keeps typography and custom prompt, removes old key, and separates feature switches', async (t) => {
  const disk = storage();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: disk });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
  const key = 'epub.ts:advanced-settings';
  disk.setItem(key, JSON.stringify({ fonts: { serif: 'My Reading Font' }, textAlignment: 'justify', translator: 'llm', llmApiKey: 'legacy-secret', llmTranslationPrompt: 'Explain {{selectedText}}' }));
  const applied = [];
  const settings = createAdvancedSettingsController((value) => { applied.push(value); });
  assert.equal(settings.value.fonts.serif, 'My Reading Font');
  assert.equal(settings.value.textAlignment, 'justify');
  assert.equal(settings.value.llmEnabled, true);
  assert.equal(settings.value.translationEnabled, true);
  assert.equal(disk.getItem(key).includes('legacy-secret'), false);
  const config = JSON.parse(disk.getItem(AI_STORAGE_KEY));
  assert.equal(config.prompt, 'Explain {{selectedText}}');
  assert.equal(config.rememberApiKey, false);
  assert.equal('apiKey' in config, false);
  await settings.setTranslationEnabled(false);
  await settings.setLlmEnabled(true);
  assert.equal(settings.value.translationEnabled, false);
  assert.equal(settings.value.llmEnabled, true);
  assert.equal(applied.length, 0, 'switches must not trigger book reflow');
  const restored = createAdvancedSettingsController(() => {});
  assert.equal(restored.value.translationEnabled, false);
  assert.equal(restored.value.llmEnabled, true);
});

test('Ask has its own selection state, waits for Send, and dismissal clears it', () => {
  let ui = {};
  let requests = 0;
  let clearedSelections = 0;
  let closedAnnotations = 0;
  let enabled = true;
  const context = createTextContext({
    closeAnnotation: () => closedAnnotations++,
    getTranslationTargetLanguage: () => 'zh-cn',
    getTranslationEnabled: () => false,
    getLlmEnabled: () => enabled,
    requestAi: async () => { requests++; return 'reply'; },
    openExternal: () => {},
    onAction: () => {},
    onClose: () => clearedSelections++,
    updateUi: (update) => { ui = { ...ui, ...update }; },
  });
  const selection = { text: 'Selected EPUB paragraph', point: { x: 120, y: 160 }, canDelete: false, canHighlight: true };
  context.open(selection);
  assert.equal(ui.contextMenu.menu.canTranslate, false);
  assert.equal(ui.contextMenu.menu.canAskLlm, true);
  ui.contextMenu.onAction('llm');
  assert.deepEqual(ui.llm, { text: selection.text, x: 120, y: 160 });
  assert.equal(ui.translation, null);
  assert.equal(requests, 0, 'opening Ask must allow editing before sending');
  assert.equal(closedAnnotations, 1);
  context.close();
  assert.equal(clearedSelections, 1);
  assert.equal(ui.llm.text, selection.text, 'the draft survives clearing the iframe selection');
  context.dismiss();
  assert.equal(ui.llm, null);
  enabled = false;
  context.open(selection);
  assert.equal(ui.contextMenu.menu.canAskLlm, false);
  ui.contextMenu.onAction('llm');
  assert.equal(ui.llm, null);
  context.destroy();
});
