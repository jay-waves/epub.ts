/** Owns dirty revisions and coalesces saves for the current book. Writers
 * snapshot edits synchronously when called, after destination preparation. */
export class BookSaveState {
  private revision = 0;
  private savedRevision = 0;
  private generation = 0;
  private pending: Promise<boolean> | null = null;
  get dirty() { return this.revision !== this.savedRevision; }
  changed() { this.revision++; }
  reset() {
    this.generation++;
    this.revision = this.savedRevision = 0;
    this.pending = null;
  }
  save<T>(prepare: () => Promise<T | null>, write: (target: T) => Promise<boolean>): Promise<boolean> {
    if (this.pending) return this.pending;
    if (!this.dirty) return Promise.resolve(true);
    const generation = this.generation;
    const prepared = prepare();
    const operation = prepared.then(async target => {
      if (target === null || generation !== this.generation) return false;
      const revision = this.revision;
      const saved = await write(target);
      if (saved && generation === this.generation) this.savedRevision = revision;
      return saved;
    }).finally(() => {
      if (this.pending === operation) this.pending = null;
    });
    this.pending = operation;
    return operation;
  }
}
