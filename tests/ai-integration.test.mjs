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
  disk.setItem(key, JSON.stringify({ fonts: { serif: 'My Reading Font' }, textAlignment: 'justify', translator: 'llm', llmApiKey: 'legacy-secret', llmTranslationPrompt: 'Explain {{selectedText}}', translationSourceLanguage: 'en', translationTargetLanguage: 'ja' }));
  const applied = [];
  const settings = createAdvancedSettingsController((value) => { applied.push(value); });
  assert.equal(settings.value.fonts.serif, 'My Reading Font');
  assert.equal(settings.value.textAlignment, 'justify');
  assert.equal(settings.value.llmEnabled, true);
  assert.equal(settings.value.translationEnabled, true);
  assert.equal(disk.getItem(key).includes('legacy-secret'), false);
  assert.equal('translationSourceLanguage' in JSON.parse(disk.getItem(key)), false);
  assert.equal('translationTargetLanguage' in JSON.parse(disk.getItem(key)), false);
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

test('Translate streams through LLM when enabled and opens Google synchronously when disabled', async () => {
  let ui = {};
  let enabled = true;
  const requests = [];
  const external = [];
  const context = createTextContext({
    closeAnnotation: () => {}, getTranslationEnabled: () => true, getLlmEnabled: () => enabled,
    requestAi: async (request, signal, onText) => { requests.push({ request, signal }); onText('partial'); return 'translated'; },
    openExternal: (url) => external.push(url), onAction: () => {}, onClose: () => {},
    updateUi: (update) => { ui = { ...ui, ...update }; },
  });
  const selection = { text: 'a & b # 中文', point: { x: 40, y: 50 }, canDelete: false, canHighlight: true };
  context.open(selection);
  ui.contextMenu.onAction('translate');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests[0].request, { text: selection.text, task: 'translate' });
  assert.equal(ui.translation.status, 'success');
  assert.equal(ui.translation.translatedText, 'translated');
  assert.equal(external.length, 0);
  enabled = false;
  context.open(selection);
  assert.equal(ui.contextMenu.menu.translationExternal, true);
  ui.contextMenu.onAction('translate');
  assert.equal(external.length, 1, 'Google must open within the click, without awaiting an API');
  assert.equal(new URL(external[0]).searchParams.get('text'), selection.text);
  assert.equal(new URL(external[0]).hostname, 'translate.google.com');
  assert.equal(requests.length, 1, 'disabling LLM must prevent further model requests');
  assert.equal(ui.translation, null);
  context.destroy();
});

test('replacing or dismissing a translation aborts it and ignores stale provider results', async () => {
  const { createTranslation } = await import('../app/reader/context-menu/translation.ts');
  const pending = [];
  const updates = [];
  const translation = createTranslation({
    requestAi: (_request, signal, onText) => new Promise((resolve) => pending.push({ signal, onText, resolve })),
    onUpdate: (value) => updates.push(value),
  });
  const first = translation.translate({ sourceText: 'first', x: 0, y: 0 });
  const second = translation.translate({ sourceText: 'second', x: 1, y: 1 });
  assert.equal(pending[0].signal.aborted, true);
  pending[0].onText('stale'); pending[0].resolve('stale'); await first;
  assert.equal(updates.some((value) => value.translatedText === 'stale'), false);
  pending[1].onText('current');
  assert.equal(updates.at(-1).translatedText, 'current');
  translation.cancel();
  assert.equal(pending[1].signal.aborted, true);
  const count = updates.length;
  pending[1].resolve('late'); await second;
  assert.equal(updates.length, count);
});
