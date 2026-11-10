import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(process.env.EPUB_TEST_URL ?? 'http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const { createTextSearch } = await import('/app/reader/text-search.ts');
    const { createSearch } = await import('/app/reader/search.ts');
    const doc = html => new DOMParser().parseFromString(html, 'text/html');
    const cases = [
      ['<p>Café CAFÉ</p>', 'cafe', 2],
      ['<p>你<b>好</b>世界你好</p>', '你好', 2],
      ['<p>a  <b> b</b></p>', 'a b', 1],
      ['<p>👩‍💻👩‍💻</p>', '👩‍💻', 2],
      ['<p>aaaa</p>', 'aa', 3],
      ['<script>word</script><style>word</style><math><mi>word</mi></math><p>word</p>', 'word', 1],
      ['<p>word</p>', '', 0],
    ];
    const counts = cases.map(([html, query, expected]) => ({ actual: [...createTextSearch(query).find(doc(html))].length, expected }));
    const lazyDoc = doc('<p>word</p><p>unneeded tail</p>');
    let tailReads = 0;
    const tail = lazyDoc.body.lastElementChild.firstChild;
    Object.defineProperty(tail, 'data', { get() { tailReads++; return 'unneeded tail'; } });
    const firstMatch = createTextSearch('word').find(lazyDoc).next().value.toString();
    const source = doc('<p>'  + 'word '.repeat(100) + '</p>');
    const rendered = doc(source.body.innerHTML);
    let scans = 0;
    const countScans = target => {
      const walk = target.createTreeWalker.bind(target);
      target.createTreeWalker = (...args) => { scans++; return walk(...args); };
    };
    countScans(source); countScans(rendered);
    const decorations = new Map();
    let lastState;
    const controller = new AbortController();
    const section = { createDocument: async () => source };
    const search = createSearch({
      book: { sections: [section], metadata: {} }, bookKey: 'test',
      navigation: { cfi: () => 'test-cfi', go: async target => target.anchor(rendered) },
      view: {
        renderer: { getContents: () => [] },
        addDecoration(index, decoration) { decorations.set(decoration.key, decoration); decoration.target(rendered); },
        removeDecoration(index, key) { decorations.delete(key); },
      },
      onUpdate: state => lastState = state, run: action => action(), signal: controller.signal,
    });
    await search.collect('word');
    const initialScans = scans;
    const hitCount = lastState.hitCount;
    await search.next(); await search.previous();
    const afterNavigationScans = scans;
    const anchor = decorations.values().next().value.target;
    const range = anchor(rendered); range.collapse(true);
    const cachedRangeIntact = anchor(rendered).toString() === 'word';
    const remounted = doc(source.body.innerHTML); countScans(remounted);
    for (const decoration of decorations.values()) decoration.target(remounted);
    const afterRemountScans = scans;
    search.clear();
    const cleared = decorations.size === 0 && !lastState.visible;
    section.createDocument = async () => doc('<p>' + 'word '.repeat(500) + '</p>');
    await search.collect('word');
    const cappedCount = lastState.hitCount;
    let release, started;
    const gate = new Promise(resolve => release = resolve);
    const loading = new Promise(resolve => started = resolve);
    section.createDocument = async () => { started(); await gate; return source; };
    const pending = search.collect('word');
    await loading;
    search.clear(); release(); await pending;
    const cancelledCleanly = decorations.size === 0 && !lastState.visible;
    const longDoc = doc('<p>' + 'a'.repeat(200000) + '</p><p>tail</p>');
    let longTailReads = 0;
    Object.defineProperty(longDoc.body.lastElementChild.firstChild, 'data', {
      get() { longTailReads++; return 'tail'; },
    });
    let timerRan = false;
    section.createDocument = async () => {
      setTimeout(() => { timerRan = true; search.clear(); }, 0);
      return longDoc;
    };
    await search.collect('never-matches');
    const longScanCancelled = timerRan && longTailReads === 0 && !lastState.visible;
    search.dispose(); await search.collect('word');
    return { longScanCancelled, firstMatch, tailReads, cappedCount, cancelledCleanly, counts, initialScans, hitCount, afterNavigationScans, cachedRangeIntact, afterRemountScans, cleared, disposedCount: decorations.size };
  });
  for (const item of result.counts) assert.equal(item.actual, item.expected);
  assert.equal(result.longScanCancelled, true);
  assert.equal(result.firstMatch, 'word');
  assert.equal(result.tailReads, 0);
  assert.equal(result.cappedCount, 200);
  assert.equal(result.cancelledCleanly, true);
  assert.equal(result.hitCount, 100);
  assert.equal(result.initialScans, 2);
  assert.equal(result.afterNavigationScans, 2);
  assert.equal(result.afterRemountScans, 3);
  assert.equal(result.cachedRangeIntact, true);
  assert.equal(result.cleared, true);
  assert.equal(result.disposedCount, 0);
  console.log(result);
} finally { await browser.close(); }
