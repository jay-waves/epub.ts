const MIN_VELOCITY = 0.08;
const MAX_VELOCITY = 2.5;
const STOP_VELOCITY = 0.02;
const TIME_CONSTANT_MS = 180;
const DISTANCE_TIME_CONSTANT_MS = 52;
const STOP_DISTANCE = 0.5;
const MAX_PENDING_DISTANCE = 320;

type KineticScrollerOptions = {
  canRun: () => boolean;
  scrollBy: (delta: number) => boolean | void;
};

/** Owns discrete-wheel smoothing and touch release inertia. */
export class KineticScroller {
  readonly #canRun: () => boolean;
  readonly #scrollBy: (delta: number) => boolean | void;
  #frame: number | undefined;
  #lastTime = 0;
  #velocity = 0;
  #distance = 0;

  constructor({ canRun, scrollBy }: KineticScrollerOptions) {
    this.#canRun = canRun;
    this.#scrollBy = scrollBy;
  }

  stop() {
    this.#velocity = 0;
    this.#distance = 0;
    this.#lastTime = 0;
    if (this.#frame !== undefined) window.cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
  }

  start(velocity: number) {
    this.stop();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || Math.abs(velocity) < MIN_VELOCITY) return;
    this.#velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocity));
    this.#frame = window.requestAnimationFrame(this.#step);
  }

  /** Smooths discrete wheel steps without manufacturing a delayed velocity tail. */
  pushDistance(distance: number) {
    if (!this.#canRun() || !Number.isFinite(distance) || !distance) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.stop();
      this.#scrollBy(distance);
      return;
    }
    this.#velocity = 0;
    this.#distance = Math.max(-MAX_PENDING_DISTANCE, Math.min(
      MAX_PENDING_DISTANCE,
      this.#distance + distance,
    ));
    if (this.#frame === undefined) {
      this.#lastTime = 0;
      this.#frame = window.requestAnimationFrame(this.#step);
    }
  }

  readonly #step = (time: number) => {
    if (!this.#canRun()) {
      this.stop();
      return;
    }
    const elapsed = this.#lastTime ? Math.min(32, time - this.#lastTime) : 16;
    this.#lastTime = time;
    if (Math.abs(this.#distance) >= STOP_DISTANCE) {
      const step = this.#distance * (1 - Math.exp(-elapsed / DISTANCE_TIME_CONSTANT_MS));
      this.#distance -= step;
      if (this.#scrollBy(step) === false) {
        this.stop();
        return;
      }
    } else if (Math.abs(this.#velocity) >= STOP_VELOCITY) {
      if (this.#scrollBy(this.#velocity * elapsed) === false) {
        this.stop();
        return;
      }
      this.#velocity *= Math.exp(-elapsed / TIME_CONSTANT_MS);
    } else {
      this.stop();
      return;
    }
    this.#frame = window.requestAnimationFrame(this.#step);
  };
}
