import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/context-menu/annotation-repository.ts')) {
      if (specifier === '#platform') return {
        url: 'data:text/javascript,export const platform = { readViewerMetadata: async () => [], writeViewerMetadata: async () => {} };',
        shortCircuit: true,
      };
      if (specifier.endsWith('/annotation')) return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});
const { annotationRepository: repository } = await import('../app/reader/context-menu/annotation-repository.ts');
hooks.deregister();
const annotation = (id, value, createdAt = 1) => ({ id, value, color: 'yellow', createdAt, updatedAt: createdAt });

test('overlay imports and edits keep identity and location indexes consistent', async () => {
  const first = annotation('one', 'cfi-a');
  const moved = annotation('one', 'cfi-b', 2);
  const replacement = annotation('two', 'cfi-b', 3);
  await repository.replace('book', [first, moved, replacement]);
  assert.deepEqual(repository.all(), [replacement]);
  assert.equal(repository.getByCfi('cfi-a'), undefined);
  assert.deepEqual(repository.getByCfi('cfi-b'), replacement);
  await repository.remove('book', 'one');
  assert.deepEqual(repository.all(), [replacement]);

  await repository.put('book', first);
  const combined = annotation('one', 'cfi-b', 4);
  await repository.put('book', combined);
  assert.deepEqual(repository.all(), [combined]);
  assert.equal(repository.getByCfi('cfi-a'), undefined);
  await repository.remove('book', 'one');
  assert.deepEqual(repository.all(), []);
  assert.equal(repository.getByCfi('cfi-b'), undefined);
  repository.clearMemory();
});
