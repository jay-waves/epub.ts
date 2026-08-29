type PointerAxis = "horizontal" | "vertical";

type PointerMotionOptions = {
  axisRatio: number;
  threshold: number;
};

const VELOCITY_IDLE_MS = 80;

/** Tracks one direct-pointer gesture without coupling DOM events to navigation. */
export class PointerMotion {
  readonly #axisRatio: number;
  readonly #threshold: number;
  readonly #startX: number;
  readonly #startY: number;
  #axis: PointerAxis | null = null;
  #lastX: number;
  #lastY: number;
  #lastTime: number;
  #moved = false;
  #velocityX = 0;
  #velocityY = 0;

  constructor(x: number, y: number, time: number, options: PointerMotionOptions) {
    this.#axisRatio = options.axisRatio;
    this.#threshold = options.threshold;
    this.#startX = this.#lastX = x;
    this.#startY = this.#lastY = y;
    this.#lastTime = time;
  }

  get axis() { return this.#axis; }
  get moved() { return this.#moved; }

  isTap(x: number, y: number) {
    return !this.#moved && !this.#exceedsThreshold(x, y);
  }

  move(x: number, y: number, time: number) {
    const deltaX = x - this.#lastX;
    const deltaY = y - this.#lastY;
    const elapsed = time - this.#lastTime;
    this.#lastX = x;
    this.#lastY = y;
    this.#lastTime = time;

    if (elapsed > 0) {
      this.#velocityX = deltaX / elapsed;
      this.#velocityY = deltaY / elapsed;
    }

    this.#moved ||= this.#exceedsThreshold(x, y);
    if (!this.#axis && this.#moved) {
      const movementX = x - this.#startX;
      const movementY = y - this.#startY;
      if (Math.abs(movementX) >= Math.abs(movementY) * this.#axisRatio) this.#axis = "horizontal";
      else if (Math.abs(movementY) >= Math.abs(movementX) * this.#axisRatio) this.#axis = "vertical";
    }

    return { axis: this.#axis, deltaX, deltaY };
  }

  velocity(time: number) {
    return time - this.#lastTime <= VELOCITY_IDLE_MS
      ? [this.#velocityX, this.#velocityY] as const
      : [0, 0] as const;
  }

  #exceedsThreshold(x: number, y: number) {
    return Math.max(Math.abs(x - this.#startX), Math.abs(y - this.#startY)) >= this.#threshold;
  }
}
