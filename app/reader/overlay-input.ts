type Overlay = {
  contains: (event: Event) => boolean;
  dismiss: () => void;
};

/** Owns input exclusion across the shell and every reader iframe. */
export class OverlayInput {
  #overlays = new Set<Overlay>();
  #listeners = new Set<() => void>();
  #dismissGesture = false;
  #contextGesture = false;

  get locked() {
    return this.#overlays.size > 0 || this.#dismissGesture || this.#contextGesture;
  }

  register(overlay: Overlay) {
    this.#overlays.add(overlay);
    this.#listeners.forEach((listener) => listener());
    return () => { this.#overlays.delete(overlay); };
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  capture = (event: Event) => {
    const overlay = [...this.#overlays].at(-1);
    // A fresh press starts a new gesture, including after a cancelled click.
    if (event.type === "pointerdown") {
      this.#dismissGesture = false;
      this.#contextGesture = false;
    }
    if (event.type === "keydown") this.#contextGesture = false;
    // Cancel before React mounts the menu, and before a secondary-button
    // release can finish a gesture. mousedown also covers chorded buttons.
    if (event.type === "contextmenu"
      || ((event.type === "pointerdown" || event.type === "mousedown")
        && ((event as MouseEvent).button === 2
          || ((event as MouseEvent).button === 0 && (event as MouseEvent).ctrlKey)))) {
      this.#contextGesture = true;
      this.#listeners.forEach((listener) => listener());
    }
    const outside = overlay && !overlay.contains(event);
    const escape = overlay && event.type === "keydown" && (event as KeyboardEvent).key === "Escape";
    if (!this.#dismissGesture && !outside && !escape) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "pointerdown") this.#dismissGesture = true;
    if (event.type === "pointercancel") this.#dismissGesture = false;
    if (event.type === "click" || event.type === "auxclick") {
      // Consume the terminal event before releasing the lock. Nothing in the
      // reader may reinterpret this click after dismiss() changes UI state.
      overlay?.dismiss();
      this.#dismissGesture = false;
    } else if (escape) {
      overlay?.dismiss();
    }
  };
}

export const overlayInput = new OverlayInput();

export const overlayInputEvents = [
  "pointerdown", "pointermove", "pointerup", "pointercancel",
  "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu",
  "wheel", "keydown", "keyup",
] as const;
