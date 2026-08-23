type NavigationTask<T> = () => T | Promise<T>;

/** Serializes user navigation and coalesces reflows requested during a move. */
export class NavigationTransaction {
  #active = false;
  #idle: Promise<void> | undefined;
  #pending = 0;
  #resolveIdle: (() => void) | undefined;
  #queue = Promise.resolve();
  #reflowPending = false;

  get busy() { return this.#active || this.#pending > 0; }

  deferReflow() {
    if (!this.#active) return false;
    this.#reflowPending = true;
    return true;
  }

  beginReflow() {
    if (this.deferReflow()) return false;
    this.#reflowPending = false;
    return true;
  }

  async run<T>(task: NavigationTask<T>, reflow: () => void): Promise<T | undefined> {
    if (this.#active) return undefined;
    this.#active = true;
    const idle = Promise.withResolvers<void>();
    this.#idle = idle.promise;
    this.#resolveIdle = idle.resolve;
    try {
      return await task();
    } finally {
      this.#active = false;
      this.#resolveIdle?.();
      this.#idle = undefined;
      this.#resolveIdle = undefined;
      if (this.#reflowPending) {
        this.#reflowPending = false;
        reflow();
      }
    }
  }

  enqueue<T>(task: NavigationTask<T>, reflow: () => void): Promise<T | undefined> {
    this.#pending += 1;
    const result = this.#queue.then(async () => {
      if (this.#idle) await this.#idle;
      return this.run(task, reflow);
    });
    this.#queue = result.then(() => undefined, () => undefined);
    return result.finally(() => this.#pending -= 1);
  }
}
