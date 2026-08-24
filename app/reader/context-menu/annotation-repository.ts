import type { ReaderAnnotation } from "../../epub/annotation";
import { normalizeAnnotation } from "../../epub/annotation";
import { platform } from "#platform";

const storageKey = (bookKey: string) => `reading-annotations:${bookKey}`;
const legacyStorageKey = (bookKey: string) => `reading-highlights:${bookKey}`;

/** Local annotation working set with indexes for rendering and list UIs. */
class AnnotationRepository {
  #pendingWrite = Promise.resolve();
  readonly #byCfi = new Map<string, ReaderAnnotation>();
  readonly #byId = new Map<string, ReaderAnnotation>();
  readonly #bySection = new Map<number, Set<ReaderAnnotation>>();
  #bookKey = "";

  all() {
    return [...this.#byId.values()].sort((a, b) =>
      (a.index ?? Infinity) - (b.index ?? Infinity)
      || (a.fraction ?? Infinity) - (b.fraction ?? Infinity)
      || a.createdAt - b.createdAt);
  }

  getByCfi(cfi: string) { return this.#byCfi.get(cfi); }
  forSection(index: number) { return [...(this.#bySection.get(index) ?? [])]; }

  async load(bookKey: string) {
    if (this.#bookKey === bookKey) return this.all();
    const current = await platform.readViewerMetadata<unknown[]>(storageKey(bookKey));
    const stored = current ?? await platform.readViewerMetadata<unknown[]>(legacyStorageKey(bookKey));
    this.#set(bookKey, stored ?? []);
    if (!current && stored) await this.#persist(bookKey);
    return this.all();
  }

  async replace(bookKey: string, annotations: readonly unknown[]) {
    this.#set(bookKey, annotations);
    await this.#persist(bookKey);
    return this.all();
  }

  async put(bookKey: string, annotation: ReaderAnnotation) {
    if (this.#bookKey !== bookKey) await this.load(bookKey);
    const previous = this.#byId.get(annotation.id) ?? this.#byCfi.get(annotation.value);
    if (previous) this.#delete(previous);
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
    this.#bySection.clear();
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
    this.#byId.set(annotation.id, annotation);
    this.#byCfi.set(annotation.value, annotation);
    if (typeof annotation.index !== "number") return;
    const section = this.#bySection.get(annotation.index) ?? new Set();
    section.add(annotation);
    this.#bySection.set(annotation.index, section);
  }

  #delete(annotation: ReaderAnnotation) {
    this.#byId.delete(annotation.id);
    if (this.#byCfi.get(annotation.value) === annotation) this.#byCfi.delete(annotation.value);
    if (typeof annotation.index !== "number") return;
    const section = this.#bySection.get(annotation.index);
    section?.delete(annotation);
    if (!section?.size) this.#bySection.delete(annotation.index);
  }

  #persist(bookKey: string) {
    const snapshot = this.all();
    const result = this.#pendingWrite.then(
      () => platform.writeViewerMetadata(storageKey(bookKey), snapshot),
    );
    this.#pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const annotationRepository = new AnnotationRepository();
