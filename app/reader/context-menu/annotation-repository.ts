import type { ReaderAnnotation } from "../../epub/annotation";
import { normalizeAnnotation } from "../../epub/annotation";
import { platform } from "#platform";

const storageKey = (bookKey: string) => `reading-annotations:${bookKey}`;
const legacyStorageKey = (bookKey: string) => `reading-highlights:${bookKey}`;

/** Current book annotations, indexed by identity and text location. */
class AnnotationRepository {
  #pendingWrite = Promise.resolve();
  readonly #byCfi = new Map<string, ReaderAnnotation>();
  readonly #byId = new Map<string, ReaderAnnotation>();
  #bookKey = "";

  all() {
    return [...this.#byId.values()].sort((a, b) =>
      (a.index ?? Infinity) - (b.index ?? Infinity)
      || (a.fraction ?? Infinity) - (b.fraction ?? Infinity)
      || a.createdAt - b.createdAt);
  }

  getByCfi(cfi: string) { return this.#byCfi.get(cfi); }

  async load(bookKey: string) {
    if (this.#bookKey === bookKey) return this.all();
    const current = await platform.readViewerMetadata<unknown[]>(storageKey(bookKey));
    const legacy = current === undefined
      ? await platform.readViewerMetadata<unknown[]>(legacyStorageKey(bookKey))
      : undefined;
    const stored = current ?? legacy ?? [];
    this.#set(bookKey, stored);
    if (current === undefined) await this.#persist(bookKey);
    return this.all();
  }

  async replace(bookKey: string, annotations: readonly unknown[]) {
    this.#set(bookKey, annotations);
    await this.#persist(bookKey);
  }

  async put(bookKey: string, annotation: ReaderAnnotation) {
    if (this.#bookKey !== bookKey) await this.load(bookKey);
    this.#add(annotation);
    await this.#persist(bookKey);
  }

  async remove(bookKey: string, id: string) {
    if (this.#bookKey !== bookKey) await this.load(bookKey);
    const annotation = this.#byId.get(id);
    if (!annotation) return;
    this.#delete(annotation);
    await this.#persist(bookKey);
  }

  clearMemory() {
    this.#bookKey = "";
    this.#byCfi.clear();
    this.#byId.clear();
  }

  #set(bookKey: string, values: readonly unknown[]) {
    this.clearMemory();
    this.#bookKey = bookKey;
    for (const value of values) {
      const annotation = normalizeAnnotation(value);
      if (annotation) this.#add(annotation);
    }
  }

  #add(annotation: ReaderAnnotation) {
    // Both identities are unique, including when importing an overlay.
    const byId = this.#byId.get(annotation.id);
    const byCfi = this.#byCfi.get(annotation.value);
    if (byId) this.#delete(byId);
    if (byCfi && byCfi !== byId) this.#delete(byCfi);
    this.#byId.set(annotation.id, annotation);
    this.#byCfi.set(annotation.value, annotation);
  }

  #delete(annotation: ReaderAnnotation) {
    this.#byId.delete(annotation.id);
    this.#byCfi.delete(annotation.value);
  }

  #persist(bookKey: string) {
    // Storage has no display order; sort only when a consumer requests all().
    const snapshot = [...this.#byId.values()];
    const result = this.#pendingWrite.then(
      () => platform.writeViewerMetadata(storageKey(bookKey), snapshot),
    );
    this.#pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const annotationRepository = new AnnotationRepository();
