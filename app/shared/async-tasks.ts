export class SerialTaskQueue {
  #pending = Promise.resolve();

  add<Result>(task: () => Promise<Result> | Result) {
    const result = this.#pending.then(task);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  idle() {
    return this.#pending;
  }
}

export class TaskTracker {
  readonly #tasks = new Set<Promise<unknown>>();

  track<Result>(task: Promise<Result>) {
    this.#tasks.add(task);
    void task.finally(() => this.#tasks.delete(task)).catch(() => undefined);
    return task;
  }

  idle() {
    return Promise.allSettled(this.#tasks).then(() => undefined);
  }
}
