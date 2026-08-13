import { DragGesture } from "@use-gesture/vanilla";
import { WheelGestures } from "wheel-gestures";
import type { PageTurnDirection, ReaderView } from "./reader/model";
import type { Navigation } from "./reader/navigation";
import { observeRenderedDocuments } from "./reader/documents";

const SCROLL_KEY_DISTANCE_RATIO = 0.48;
const WHEEL_SCROLL_DISTANCE_RATIO = 0.6;
const SECTION_EDGE_EPSILON = 2;
const WHEEL_SWIPE_AXIS_RATIO = 1.35;
const WHEEL_SWIPE_MIN_DISTANCE = 42;
const WHEEL_SWIPE_MIN_VELOCITY = 0.32;
const WHEEL_SWIPE_SUPPRESS_SCROLL_MS = 1200;
const WHEEL_DISCRETE_DELTA_THRESHOLD_PX = 48;
const WHEEL_BOUNDARY_HOLD_MS = 140;
const TOUCH_PAN_THRESHOLD_PX = 8;
const TOUCH_LONG_PRESS_DELAY_MS = 500;
const TOUCH_EDGE_RATIO = 0.22;
const TOUCH_INERTIA_MIN_VELOCITY = 0.08;
const TOUCH_INERTIA_MAX_VELOCITY = 2.5;
const TOUCH_INERTIA_STOP_VELOCITY = 0.02;
const TOUCH_INERTIA_TIME_CONSTANT_MS = 240;

function isEditableTarget(target: EventTarget | null) {
  if (!target || (target as Node).nodeType !== Node.ELEMENT_NODE) return false;
  const element = target as HTMLElement;
  return element.isContentEditable || Boolean(element.closest(
    "input, select, textarea, button, summary, audio, video, a[href], [role='slider'], [contenteditable]:not([contenteditable='false'])",
  ));
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!target || (target as Node).nodeType !== Node.ELEMENT_NODE) return false;
  return Boolean((target as Element).closest(
    "a[href], button, input, select, textarea, label, summary, audio[controls], video[controls], [contenteditable='true']",
  ));
}

function getKeyboardScrollDistance() {
  return Math.max(120, Math.round(window.innerHeight * SCROLL_KEY_DISTANCE_RATIO));
}

function isScrollUpKey(key: string) {
  return key === "ArrowUp" || key === "k";
}

function isScrollDownKey(key: string) {
  return key === "ArrowDown" || key === "j" || key === " ";
}

type ViewerInputOptions = {
  getView: () => ReaderView | null;
  getNavigation: () => Navigation | null;
  getFlow: () => "paginated" | "scrolled";
  canTurnPage: () => boolean;
  onChapterBoundary: (direction: number, pending: boolean) => void;
  onScrollEdge: (direction: number) => void;
  openSearch: () => boolean;
  closeSearch: () => boolean;
  saveBook: () => void;
};

/** Normalizes keyboard, wheel, and pointer input from both the shell and reader iframes. */
export function createViewerInput(options: ViewerInputOptions) {
  const inputTargets = new Map<Document, () => void>();
  const bindings = new Map<ReaderView, {
    previousTouchAction: string;
    stopDocuments: () => void;
    stopShellDrag: () => void;
  }>();
  let suppressWheelScrollUntil = 0;
  let inertiaFrame: number | undefined;
  let inertiaLastTime = 0;
  let inertiaVelocity = 0;
  let wheelBoundaryTimer: number | undefined;
  let wheelBoundaryConsumed = false;
  let wheelBoundaryDirection = 0;
  let wheelBoundaryInFlight = false;
  const activeWheelTargets = new Set<Document>();

  const stopTouchInertia = () => {
    inertiaVelocity = 0;
    inertiaLastTime = 0;
    if (inertiaFrame !== undefined) {
      window.cancelAnimationFrame(inertiaFrame);
      inertiaFrame = undefined;
    }
  };

  const clearWheelBoundary = () => {
    if (wheelBoundaryTimer !== undefined) window.clearTimeout(wheelBoundaryTimer);
    wheelBoundaryTimer = undefined;
    if (wheelBoundaryDirection) options.onChapterBoundary(wheelBoundaryDirection, false);
    wheelBoundaryDirection = 0;
    wheelBoundaryInFlight = false;
    if (!activeWheelTargets.size) wheelBoundaryConsumed = false;
  };

  const crossWheelBoundary = (direction: number, distance: number) => {
    if (wheelBoundaryConsumed) return;
    wheelBoundaryConsumed = true;
    wheelBoundaryDirection = direction;
    options.onChapterBoundary(direction, true);
    wheelBoundaryTimer = window.setTimeout(() => {
      wheelBoundaryTimer = undefined;
      wheelBoundaryInFlight = true;
      const navigation = options.getNavigation();
      const crossing = direction < 0 ? navigation?.prev(distance) : navigation?.next(distance);
      void Promise.resolve(crossing)
        .catch((error) => console.warn("Failed to cross reader chapter boundary.", error))
        .finally(clearWheelBoundary);
    }, WHEEL_BOUNDARY_HOLD_MS);
  };

  const suppressWheelScroll = () => {
    suppressWheelScrollUntil = performance.now() + WHEEL_SWIPE_SUPPRESS_SCROLL_MS;
  };

  const isWheelScrollSuppressed = () => performance.now() < suppressWheelScrollUntil;

  const getSectionScrollMetrics = () => {
    const renderer = options.getView()?.renderer;
    const { end, start, viewSize } = renderer ?? {};
    if (!renderer || typeof end !== "number" || typeof start !== "number" || typeof viewSize !== "number") return null;
    return { end, renderer, start, viewSize };
  };

  const eventBelongsToReader = (event: { target?: EventTarget | null }) => {
    const target = event.target as Node | null;
    // DOM nodes from a reader iframe do not pass the host realm's instanceof Node.
    if (!target || typeof target !== "object" || typeof target.nodeType !== "number") return false;
    if (target.ownerDocument !== document) return true;
    const view = options.getView();
    return Boolean(view && (target === view || view.contains(target)));
  };

  const signalScrollEdge = (direction: number) => {
    if (isWheelScrollSuppressed()) return;
    if (options.getFlow() === "scrolled") options.onScrollEdge(direction);
  };

  const scrollWheelBy = (delta: number) => {
    if (options.getFlow() !== "scrolled") return;
    const metrics = getSectionScrollMetrics();
    if (!metrics) return;
    const direction = Math.sign(delta);
    if (!direction) return;
    const remaining = direction < 0 ? metrics.start : metrics.viewSize - metrics.end;
    if (remaining <= SECTION_EDGE_EPSILON) {
      const atBookEdge = direction < 0 ? metrics.renderer.atStart : metrics.renderer.atEnd;
      if (atBookEdge) signalScrollEdge(direction);
      else crossWheelBoundary(direction, Math.abs(delta));
      return;
    }
    const applied = Math.sign(delta) * Math.min(Math.abs(delta), remaining);
    options.getNavigation()?.scrollBy(applied);
  };

  const scrollCurrentSectionWithBounds = (direction: number, distance: number) => {
    const metrics = getSectionScrollMetrics();
    if (!metrics) return;

    const remaining = direction < 0 ? metrics.start : metrics.viewSize - metrics.end;
    if (remaining <= SECTION_EDGE_EPSILON) {
      const atBookEdge = direction < 0 ? metrics.renderer.atStart : metrics.renderer.atEnd;
      if (atBookEdge) signalScrollEdge(direction);
      else void (direction < 0 ? options.getNavigation()?.prev(distance) : options.getNavigation()?.next(distance));
      return;
    }

    const navigation = options.getNavigation();
    void (direction < 0
      ? navigation?.prev(Math.min(distance, remaining))
      : navigation?.next(Math.min(distance, remaining)));
  };

  const turnPage = (direction: PageTurnDirection) => {
    if (!options.canTurnPage()) return;
    const view = options.getView();
    const renderer = view?.renderer;
    if (!renderer) return;

    const isRtl = view.book?.dir === "rtl";
    const shouldGoNext = direction === "left" ? isRtl : !isRtl;
    const isBookEdge = shouldGoNext ? renderer.atEnd : renderer.atStart;
    if (isBookEdge) {
      signalScrollEdge(shouldGoNext ? 1 : -1);
      return;
    }

    const navigation = options.getNavigation();
    void (direction === "left" ? navigation?.left() : navigation?.right())
      ?.catch((error) => console.warn("Failed to turn reader page.", error));
  };

  const handleScrollKeyDown = (event: KeyboardEvent, direction: number) => {
    event.preventDefault();
    scrollCurrentSectionWithBounds(direction, getKeyboardScrollDistance());
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    stopTouchInertia();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (event.repeat) return;
      options.saveBook();
      return;
    }

    if (event.key === "Escape") {
      if (options.closeSearch()) event.preventDefault();
      return;
    }

    if (isEditableTarget(event.target)) return;

    if (event.key === "ArrowLeft" || event.key === "h") {
      event.preventDefault();
      if (event.repeat) return;
      turnPage("left");
    } else if (event.key === "ArrowRight" || event.key === "l") {
      event.preventDefault();
      if (event.repeat) return;
      turnPage("right");
    } else if (options.getFlow() === "scrolled" && isScrollUpKey(event.key)) {
      handleScrollKeyDown(event, -1);
    } else if (options.getFlow() === "scrolled" && isScrollDownKey(event.key)) {
      handleScrollKeyDown(event, 1);
    } else if (event.key === "/") {
      if (options.openSearch()) event.preventDefault();
    }
  };

  const handleBlur = () => {
    stopTouchInertia();
  };

  const edgeDirection = (sourceDocument: Document, clientX: number): PageTurnDirection | null => {
    const frame = sourceDocument.defaultView?.frameElement;
    const frameLeft = frame?.nodeType === Node.ELEMENT_NODE
      ? (frame as Element).getBoundingClientRect().left
      : 0;
    const rect = options.getView()?.getBoundingClientRect();
    if (!rect?.width) return null;
    const x = frameLeft + clientX - rect.left;
    if (x <= rect.width * TOUCH_EDGE_RATIO) return "left";
    if (x >= rect.width * (1 - TOUCH_EDGE_RATIO)) return "right";
    return null;
  };

  const stepTouchInertia = (time: number) => {
    if (options.getFlow() !== "scrolled" || Math.abs(inertiaVelocity) < TOUCH_INERTIA_STOP_VELOCITY) {
      stopTouchInertia();
      return;
    }
    const elapsed = inertiaLastTime ? Math.min(32, time - inertiaLastTime) : 16;
    inertiaLastTime = time;
    const metrics = getSectionScrollMetrics();
    if (!metrics) {
      stopTouchInertia();
      return;
    }
    const direction = Math.sign(inertiaVelocity);
    const remaining = direction < 0 ? metrics.start : metrics.viewSize - metrics.end;
    if (remaining <= SECTION_EDGE_EPSILON) {
      signalScrollEdge(direction);
      stopTouchInertia();
      return;
    }
    const delta = inertiaVelocity * elapsed;
    options.getNavigation()?.scrollBy(Math.sign(delta) * Math.min(Math.abs(delta), remaining));
    inertiaVelocity *= Math.exp(-elapsed / TOUCH_INERTIA_TIME_CONSTANT_MS);
    inertiaFrame = window.requestAnimationFrame(stepTouchInertia);
  };

  const startTouchInertia = (velocity: number) => {
    stopTouchInertia();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || Math.abs(velocity) < TOUCH_INERTIA_MIN_VELOCITY) return;
    inertiaVelocity = Math.max(-TOUCH_INERTIA_MAX_VELOCITY, Math.min(TOUCH_INERTIA_MAX_VELOCITY, velocity));
    inertiaFrame = window.requestAnimationFrame(stepTouchInertia);
  };

  const bindDragGesture = (target: EventTarget, sourceDocument: Document) => {
    let longPressTimer: number | undefined;
    let active = false;
    let selecting = false;
    const clearLongPress = () => {
      if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
      longPressTimer = undefined;
    };
    const drag = new DragGesture<PointerEvent>(target, (state) => {
      const event = state.event;
      const starting = event.type === "pointerdown";
      const ending = event.type === "pointerup" || event.type === "pointercancel";
      if (starting) {
        if (state.canceled) return;
        active = false;
        selecting = false;
        if (!eventBelongsToReader(event) || !event.isPrimary || event.button !== 0
          || isInteractiveTarget(event.target)) {
          state.cancel();
          return;
        }
        active = true;
        stopTouchInertia();
        if (event.pointerType === "touch") {
          longPressTimer = window.setTimeout(() => {
            if (!state.intentional) selecting = true;
          }, TOUCH_LONG_PRESS_DELAY_MS);
        }
      }

      if (!active) return;
      if (state.intentional) clearLongPress();
      if (selecting) {
        if (ending) {
          active = false;
          clearLongPress();
        }
        return;
      }
      if (ending) {
        active = false;
        clearLongPress();
        if (state.canceled || event.type === "pointercancel") return;
        if (state.tap) {
          const direction = edgeDirection(sourceDocument, event.clientX);
          if (direction) {
            event.preventDefault();
            event.stopPropagation();
            turnPage(direction);
          }
        } else if (event.pointerType !== "mouse") {
          const velocityX = -state.direction[0] * state.velocity[0];
          const velocityY = -state.direction[1] * state.velocity[1];
          if (options.getFlow() === "paginated") options.getView()?.renderer?.settle?.(velocityX, velocityY);
          else startTouchInertia(velocityY);
        }
        return;
      }
      if (!state.intentional || event.pointerType === "mouse") return;

      event.preventDefault();
      event.stopPropagation();
      const dx = -state.delta[0];
      const dy = -state.delta[1];
      if (options.getFlow() === "scrolled") options.getNavigation()?.scrollBy(dy);
      else options.getView()?.renderer?.scrollBy?.(dx, dy);
    }, {
      eventOptions: { capture: true, passive: false },
      filterTaps: true,
      pointer: { buttons: 1, capture: false, keys: false },
      threshold: TOUCH_PAN_THRESHOLD_PX,
      triggerAllEvents: true,
      window: sourceDocument.defaultView ?? window,
    });
    return () => {
      clearLongPress();
      drag.destroy();
    };
  };

  const bindWheelGesture = (targetDocument: Document) => {
    const wheel = WheelGestures({ preventWheelAction: false });
    let swipeConsumed = false;
    const stopListening = wheel.on("wheel", (state) => {
      if (state.isStart) {
        activeWheelTargets.add(targetDocument);
        swipeConsumed = false;
        if (!wheelBoundaryInFlight && wheelBoundaryTimer === undefined) wheelBoundaryConsumed = false;
      }
      if (state.isEnding || state.isMomentumCancel) {
        activeWheelTargets.delete(targetDocument);
        swipeConsumed = false;
        if (!activeWheelTargets.size && !wheelBoundaryInFlight && wheelBoundaryTimer === undefined) {
          wheelBoundaryConsumed = false;
        }
        return;
      }

      const event = state.event as WheelEvent;
      if (!eventBelongsToReader(event) || event.ctrlKey || event.metaKey) return;
      const [axisX, axisY] = state.axisDelta;
      const deltaX = -axisX;
      const deltaY = -axisY;
      const isHorizontal = Math.abs(deltaX) >= Math.abs(deltaY) * WHEEL_SWIPE_AXIS_RATIO;
      if (isHorizontal) event.preventDefault();

      if (!state.isMomentum && !swipeConsumed && event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
        const [movementX, movementY] = state.axisMovement;
        const [velocityX] = state.axisVelocity;
        const isHorizontalSwipe = Math.abs(movementX) >= WHEEL_SWIPE_MIN_DISTANCE
          && Math.abs(movementX) >= Math.abs(movementY) * WHEEL_SWIPE_AXIS_RATIO
          && Math.abs(velocityX) >= WHEEL_SWIPE_MIN_VELOCITY;
        if (isHorizontalSwipe) {
          swipeConsumed = true;
          suppressWheelScroll();
          turnPage(movementX < 0 ? "left" : "right");
          return;
        }
      }

      if (options.getFlow() !== "scrolled" || isWheelScrollSuppressed() || isHorizontal) return;
      const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
      const direction = Math.sign(delta);
      if (!direction) return;
      if (wheelBoundaryTimer !== undefined && direction !== wheelBoundaryDirection) {
        clearWheelBoundary();
        wheelBoundaryConsumed = false;
      }
      stopTouchInertia();
      event.preventDefault();
      const isDiscreteWheel = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
        || Math.abs(delta) >= WHEEL_DISCRETE_DELTA_THRESHOLD_PX;
      if (isDiscreteWheel) {
        scrollCurrentSectionWithBounds(direction, getKeyboardScrollDistance());
      } else {
        scrollWheelBy(delta * WHEEL_SCROLL_DISTANCE_RATIO);
      }
    });
    const stopObserving = wheel.observe(targetDocument);
    return () => {
      activeWheelTargets.delete(targetDocument);
      stopObserving();
      stopListening();
      wheel.disconnect();
    };
  };

  const bindInputTarget = (targetDocument: Document) => {
    if (inputTargets.has(targetDocument)) return;
    const touchStyle = targetDocument === document ? null : targetDocument.createElement("style");
    if (touchStyle) {
      touchStyle.textContent = "html { touch-action: pinch-zoom !important; }";
      targetDocument.head?.append(touchStyle);
    }
    targetDocument.addEventListener("keydown", handleKeyDown);
    targetDocument.defaultView?.addEventListener("blur", handleBlur);
    const stopDrag = targetDocument === document
      ? () => {}
      : bindDragGesture(targetDocument, targetDocument);
    const stopWheel = bindWheelGesture(targetDocument);
    inputTargets.set(targetDocument, () => {
      stopDrag();
      stopWheel();
      targetDocument.removeEventListener("keydown", handleKeyDown);
      targetDocument.defaultView?.removeEventListener("blur", handleBlur);
      touchStyle?.remove();
    });
  };

  const unbindInputTarget = (targetDocument: Document) => {
    inputTargets.get(targetDocument)?.();
    inputTargets.delete(targetDocument);
  };

  const bindReaderView = (view: ReaderView) => {
    if (bindings.has(view)) return;
    const previousTouchAction = view.style.touchAction;
    view.style.touchAction = "pinch-zoom";
    const stopShellDrag = bindDragGesture(view, document);
    const stopDocuments = observeRenderedDocuments(view, ({ doc }, signal) => {
      bindInputTarget(doc);
      signal.addEventListener("abort", () => unbindInputTarget(doc), { once: true });
    });
    bindings.set(view, { previousTouchAction, stopDocuments, stopShellDrag });
  };

  const unbindReaderView = (view: ReaderView) => {
    const binding = bindings.get(view);
    if (!binding) return;
    binding.stopShellDrag();
    binding.stopDocuments();
    if (binding.previousTouchAction) view.style.touchAction = binding.previousTouchAction;
    else view.style.removeProperty("touch-action");
    bindings.delete(view);
  };

  bindInputTarget(document);
  return {
    bindReaderView,
    destroy: () => {
      stopTouchInertia();
      activeWheelTargets.clear();
      clearWheelBoundary();
      bindings.forEach((_, view) => unbindReaderView(view));
      inputTargets.forEach((dispose) => dispose());
      inputTargets.clear();
    },
    unbindReaderView,
  };
}
