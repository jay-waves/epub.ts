/** Keeps a cancelled wheel stream cancelled until its real end. */
export class WheelInputSession {
  #active = false;
  #cancelled = false;
  #pending: ReturnType<typeof setTimeout> | undefined;

  get cancelled() { return this.#cancelled; }

  start() {
    this.#active = true;
    this.#cancelled = false;
  }

  end() {
    this.#active = false;
  }

  cancel() {
    if (this.#active) this.#cancelled = true;
    if (this.#pending !== undefined) clearTimeout(this.#pending);
    this.#pending = undefined;
  }

  queueTurn(turn: () => void) {
    if (this.#cancelled || this.#pending !== undefined) return;
    // Trackpad secondary taps may emit wheel events before contextmenu.
    this.#pending = setTimeout(() => {
      this.#pending = undefined;
      if (!this.#cancelled) turn();
    }, 150);
  }
}
