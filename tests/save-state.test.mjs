import test from 'node:test';
import assert from 'node:assert/strict';
import { BookSaveState } from '../app/reader/save-state.ts';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
test('save preserves edits during IO and coalesces repeated requests', async () => {
  const state = new BookSaveState(); state.changed();
  const gate = deferred(); let writes = 0;
  const first = state.save(async () => true, async () => { writes++; return gate.promise; });
  const second = state.save(async () => { throw Error('duplicate preparation'); }, async () => false);
  assert.equal(first, second);
  await Promise.resolve(); state.changed(); gate.resolve(true);
  await first; assert.equal(writes, 1); assert.equal(state.dirty, true);
  await state.save(async () => true, async () => true); assert.equal(state.dirty, false);
});
test('book switch cancels pending preparation and isolates old acknowledgements', async () => {
  const state = new BookSaveState(); state.changed();
  const prepare = deferred(); let writes = 0;
  const old = state.save(() => prepare.promise, async () => { writes++; return true; });
  state.reset(); state.changed(); prepare.resolve(true);
  assert.equal(await old, false); assert.equal(writes, 0); assert.equal(state.dirty, true);
  const ack = deferred(); const writing = state.save(async () => true, () => ack.promise);
  await Promise.resolve(); state.reset(); state.changed(); ack.resolve(true); await writing;
  assert.equal(state.dirty, true);
});
test('cancellation and failure retain dirty state and permit retry', async () => {
  const state = new BookSaveState(); state.changed();
  assert.equal(await state.save(async () => null, async () => true), false);
  await assert.rejects(state.save(async () => true, async () => { throw Error('disk'); }), /disk/);
  assert.equal(state.dirty, true);
  let prepared = false;
  const saved = state.save(() => { prepared = true; return Promise.resolve(true); }, async () => true);
  assert.equal(prepared, true, 'permission preparation starts synchronously');
  await saved; assert.equal(state.dirty, false);
});
