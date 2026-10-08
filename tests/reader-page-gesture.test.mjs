import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';

const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.includes('/app/reader/') && url.endsWith('.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)
      ? `${specifier}.ts` : specifier, context);
  },
});
const { createViewerInput } = await import('../app/reader/input.ts');
const { overlayInput } = await import('../app/reader/overlay-input.ts');
hooks.deregister();

function fixture(t) {
  const commands = [];
  class ReaderElement extends EventTarget {
    nodeType = 1;
    attributes = new Map();
    captured = null;
    isConnected = true;
    closest() { return null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
  }
  const createDocument = () => {
    const doc = new EventTarget();
    doc.defaultView = new EventTarget();
    doc.documentElement = new ReaderElement();
    doc.head = { append() {} };
    doc.createElement = () => ({ textContent: '', remove() {} });
    return doc;
  };
  const shell = createDocument();
  const chapter = createDocument();
  const previous = new Map();
  for (const [key, value] of Object.entries({ document: shell, window: shell.defaultView, Node: { ELEMENT_NODE: 1 } })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const view = new ReaderElement();
  view.ownerDocument = shell;
  view.style = { touchAction: '', removeProperty() {} };
  view.book = { dir: 'ltr' };
  view.renderer = { getContents: () => [{ doc: chapter, index: 0 }] };
  view.contains = (target) => target === view;
  let flow = 'paginated';
  const input = createViewerInput({
    getView: () => view, getNavigation: () => null, getFlow: () => flow,
    canTurnPage: () => true, onChapterBoundary() {}, onScrollEdge() {},
    dispatchCommand: (command) => commands.push(command), dispatchProgressReturn() {},
    dispatchProgressSeek() {}, dispatchSettings() {},
  });
  input.bindReaderView(view);
  t.after(() => {
    input.destroy();
    overlayInput.capture(new Event('pointerdown'));
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const emit = (doc, type, extra = {}) => {
    const target = doc === shell ? view : new ReaderElement();
    target.ownerDocument = doc;
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      target, pointerType: 'mouse', pointerId: 1, button: 2, buttons: 2,
      clientX: 200, clientY: 200, ...extra,
    })) Object.defineProperty(event, key, { value });
    doc.defaultView.dispatchEvent(event);
    return event;
  };
  return { commands, shell, chapter, view, emit, setFlow: (value) => { flow = value; } };
}

test('shell and cross-realm chapter gestures turn one page, respect RTL, and work in scrolled mode', (t) => {
  const f = fixture(t);
  const drag = (doc, position) => {
    f.emit(doc, 'pointerdown');
    assert.equal(overlayInput.locked, false);
    f.emit(doc, 'pointermove', position);
    assert.equal(doc.documentElement.attributes.get('data-reader-page-grabbing'), 'true');
    f.emit(doc, 'pointerup', { ...position, buttons: 0 });
    assert.equal(doc.documentElement.attributes.size, 0);
    f.emit(doc, 'mouseup', { ...position, buttons: 0 });
    assert.equal(f.emit(doc, 'contextmenu').defaultPrevented, true);
  };
  drag(f.shell, { clientX: 150 });
  drag(f.chapter, { clientY: 150 });
  f.view.book.dir = 'rtl';
  drag(f.chapter, { clientX: 150 });
  drag(f.chapter, { clientX: 250 });
  f.setFlow('scrolled');
  drag(f.chapter, { clientY: 250 });
  assert.deepEqual(f.commands, ['paginate-next', 'paginate-next', 'paginate-previous', 'paginate-next', 'paginate-previous']);
});

test('quick right clicks preserve menu triggers; opening an overlay cancels held gestures', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) {
    f.emit(f.chapter, 'pointerdown');
    assert.equal(f.chapter.documentElement.attributes.size, 0);
    f.emit(f.chapter, 'pointerup', { buttons: 0 });
    assert.equal(f.emit(f.chapter, 'contextmenu').defaultPrevented, false);
    assert.equal(overlayInput.locked, true);
  }
  f.emit(f.chapter, 'pointerdown');
  f.emit(f.chapter, 'pointermove', { clientX: 150 });
  const close = overlayInput.register({ contains: () => true, dismiss() {} });
  assert.equal(f.chapter.documentElement.attributes.size, 0);
  close();
  f.emit(f.chapter, 'pointerup', { clientX: 150, buttons: 0 });
  assert.deepEqual(f.commands, []);
});
