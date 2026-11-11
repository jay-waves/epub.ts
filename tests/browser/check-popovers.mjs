import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(process.env.EPUB_TEST_URL ?? 'http://127.0.0.1:5173');
  await page.evaluate(async () => { window.fixture = await import('/tests/support/point-popover.tsx'); });
  const show = async props => {
    await page.evaluate(props => window.fixture.show(props), props);
    await page.waitForFunction(point => document.querySelector('#test-popover')?.getAttribute('data-point') === point,
      `${props.x},${props.y},${props.width ?? 200},${props.height ?? 120}`);
  };
  const inside = async () => {
    await page.waitForFunction(() => {
      const el = document.querySelector('#test-popover');
      if (!el?.matches(':popover-open')) return false;
      const r = el.getBoundingClientRect();
      return r.left >= 8 && r.top >= 8 && r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8;
    });
  };
  for (const [x, y] of [[0, 0], [790, 590], [400, 300], [790, 0]]) {
    await show({ x, y }); await inside();
  }
  await show({ x: 790, y: 590, height: 420 }); await inside();
  await page.setViewportSize({ width: 500, height: 500 }); await inside();
  assert.equal(await page.evaluate(() => window.fixture.locked()), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#test-popover'));
  assert.equal(await page.evaluate(() => window.fixture.locked()), false);
  await show({ x: 100, y: 100 }); await inside();
  console.log('Popover corners, content resize, viewport resize, Escape cleanup and reopen passed');
} finally { await browser.close(); }
