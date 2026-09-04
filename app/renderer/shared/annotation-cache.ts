type CachedAnnotation<Annotation> = {
  annotation: Annotation;
  index: number;
};

/** Keeps logical annotations alive while their renderer overlays are replaced. */
export class AnnotationCache<Annotation extends { value: string }> {
  readonly #entries = new Map<string, CachedAnnotation<Annotation>>();

  set(index: number, annotation: Annotation) {
    this.#entries.set(annotation.value, { annotation, index });
  }

  delete(value: string) {
    return this.#entries.delete(value);
  }

  indexOf(value: string) {
    return this.#entries.get(value)?.index;
  }

  forSection(index: number) {
    return [...this.#entries.values()]
      .filter((entry) => entry.index === index)
      .map((entry) => entry.annotation);
  }

  clear() {
    this.#entries.clear();
  }
}
