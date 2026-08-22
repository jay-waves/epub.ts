import { DragGesture } from "@use-gesture/vanilla";
import { WheelGestures } from "wheel-gestures";
import type { ReaderView, StepDirection } from "./model";
import type { Navigation } from "./navigation";
import { observeRenderedDocuments } from "./documents";
import { KineticScroller } from "./kinetic-scroller";
import type { ReaderCommand } from "./events";
import {
  claimReaderPointer,
  consumeReaderEvent,
  consumeReaderPointerClaim,
  resolveReaderPointerIntent,
} from "./interaction-arbiter";

const SCROLL_KEY_DISTANCE_RATIO = 0.48;
const SECTION_EDGE_EPSILON = 2;
const COARSE_WHEEL_DELTA_PX = 32;
const WHEEL_SCROLL_GAIN = 1.4;
const WHEEL_SWIPE_AXIS_RATIO = 1.35;
const WHEEL_SWIPE_MIN_DISTANCE = 42;
const WHEEL_SWIPE_MIN_VELOCITY = 0.32;
const WHEEL_SWIPE_SUPPRESS_SCROLL_MS = 1200;
const TOUCH_PAN_THRESHOLD_PX = 8;
const TOUCH_LONG_PRESS_DELAY_MS = 500;
const TOUCH_EDGE_RATIO = 0.22;
const TOUCH_AXIS_RATIO = 1.2;
const TOUCH_CENTER_INSET_RATIO = 0.25;

const STEP_COMMANDS = {
  left: "step-left",
  right: "step-right",
} as const satisfies Record<StepDirection, ReaderCommand>;

function isEditableTarget(target: EventTarget | null) {
  if (!target || (target as Node).nodeType !== Node.ELEMENT_NODE) return false;
  const element = target as HTMLElement;
  return element.isContentEditable || Boolean(element.closest(
    "input, select, textarea, button, summary, audio, video, a[href], [role='slider'], [contenteditable]:not([contenteditable='false'])",
  ));
}

function isInteractiveTarget(event: { target: EventTarget | null }) {
  return resolveReaderPointerIntent(event.target) !== "content";
}

function getKeyboardScrollDistance() {
  return Math.max(120, Math.round(window.innerHeight * SCROLL_KEY_DISTANCE_RATIO));
}

type ViewerInputOptions = {
  getView: () => ReaderView | null;
  getNavigation: () => Navigation | null;
  getFlow: () => "paginated" | "scrolled";
  canTurnPage: () => boolean;
  onChapterBoundary: (direction: number, pending: boolean) => void;
  onScrollEdge: (direction: number) => void;
  dispatchCommand: (command: ReaderCommand) => void;
  dispatchProgressReturn: () => void;
  dispatchProgressSeek: (progress: number) => void;
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
  let wheelBoundaryConsumed = false;
  let wheelBoundaryDirection = 0;
  let wheelBoundaryInFlight = false;
  let progressPrefix = "";
  const activeWheelTargets = new Set<Document>();
  const dispatchStep = (direction: StepDirection) => options.dispatchCommand(STEP_COMMANDS[direction]);

  const clearWheelBoundary = () => {
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
    wheelBoundaryInFlight = true;
    const navigation = options.getNavigation();
    const crossing = direction < 0 ? navigation?.prev(distance) : navigation?.next(distance);
    void Promise.resolve(crossing)
      .catch((error) => console.warn("Failed to cross reader chapter boundary.", error))
      .finally(clearWheelBoundary);
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
    if (options.getFlow() !== "scrolled") return false;
    const metrics = getSectionScrollMetrics();
    if (!metrics) return false;
    const direction = Math.sign(delta);
    if (!direction) return false;
    const remaining = direction < 0 ? metrics.start : metrics.viewSize - metrics.end;
    if (remaining <= SECTION_EDGE_EPSILON) {
      const atBookEdge = direction < 0 ? metrics.renderer.atStart : metrics.renderer.atEnd;
      if (atBookEdge) signalScrollEdge(direction);
      else crossWheelBoundary(direction, Math.abs(delta));
      return false;
    }
    const applied = Math.sign(delta) * Math.min(Math.abs(delta), remaining);
    options.getNavigation()?.scrollBy(applied);
    return true;
  };
  const inertia = new KineticScroller({
    canRun: () => options.getFlow() === "scrolled",
    scrollBy: scrollWheelBy,
  });

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

  const turnInReadingOrder = (direction: -1 | 1, wholePage = false) => {
    if (!options.canTurnPage()) return;
    const renderer = options.getView()?.renderer;
    if (!renderer) return;
    if (direction < 0 ? renderer.atStart : renderer.atEnd) {
      signalScrollEdge(direction);
      return;
    }

    const navigation = options.getNavigation();
    const movement = direction < 0
      ? wholePage ? navigation?.prevPage() : navigation?.prev()
      : wholePage ? navigation?.nextPage() : navigation?.next();
    void movement?.catch((error) => console.warn("Failed to move reader viewport.", error));
  };

  const executeStep = (direction: StepDirection) => {
    const isRtl = options.getView()?.book?.dir === "rtl";
    const forward = direction === "left" ? isRtl : !isRtl;
    turnInReadingOrder(forward ? 1 : -1);
  };

  const executePaginate = (direction: -1 | 1) => turnInReadingOrder(direction, true);

  const scrollByKey = (direction: number) => {
    scrollCurrentSectionWithBounds(direction, getKeyboardScrollDistance());
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    inertia.stop();
    if (event.ctrlKey && event.key.toLowerCase() === "o") {
      progressPrefix = "";
      consumeReaderEvent(event);
      if (event.repeat) return;
      options.dispatchProgressReturn();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      progressPrefix = "";
      consumeReaderEvent(event);
      if (event.repeat) return;
      options.dispatchCommand("save-book");
      return;
    }

    if (event.key === "Escape") {
      progressPrefix = "";
      consumeReaderEvent(event);
      options.dispatchCommand("escape");
      return;
    }

    if (isEditableTarget(event.target)) {
      progressPrefix = "";
      return;
    }
    if (event.repeat) return consumeReaderEvent(event);

    if (event.ctrlKey || event.metaKey) {
      progressPrefix = "";
      let command: ReaderCommand | undefined;
      switch (event.key) {
        case "+":
        case "=":
          command = "zoom-in";
          break;
        case "-":
        case "_":
          command = "zoom-out";
          break;
      }
      if (!command) return;
      consumeReaderEvent(event);
      options.dispatchCommand(command);
      return;
    }

    // Keep the prefix while Shift is pressed to produce the confirming uppercase G.
    if (event.key === "Shift") return;

    const hasCommandModifiers = event.altKey || event.ctrlKey || event.metaKey;
    if (!hasCommandModifiers && /^\d$/.test(event.key)) {
      consumeReaderEvent(event);
      progressPrefix += event.key;
      return;
    }

    if (!hasCommandModifiers && event.key === "G" && progressPrefix) {
      const percentage = Number(progressPrefix);
      progressPrefix = "";
      consumeReaderEvent(event);
      if (percentage <= 100) options.dispatchProgressSeek(percentage / 100);
      return;
    }

    progressPrefix = "";

    let command: ReaderCommand | undefined;
    switch (event.key) {
      case "ArrowLeft":
      case "h":
        command = "step-left";
        break;
      case "ArrowRight":
      case "l":
        command = "step-right";
        break;
      case "ArrowUp":
      case "k":
        command = options.getFlow() === "scrolled" ? "scroll-previous" : "paginate-previous";
        break;
      case "ArrowDown":
      case "j":
        command = options.getFlow() === "scrolled" ? "scroll-next" : "paginate-next";
        break;
      case " ":
        if (options.getFlow() === "scrolled") command = "scroll-next";
        break;
      case "/":
        command = "open-search";
        break;
      case "t":
        command = "open-toc";
        break;
    }
    if (!command) return;
    consumeReaderEvent(event);
    options.dispatchCommand(command);
  };

  const edgeDirection = (sourceDocument: Document, clientX: number): StepDirection | null => {
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

  const isCenterTap = (sourceDocument: Document, clientX: number, clientY: number) => {
    const frame = sourceDocument.defaultView?.frameElement;
    const frameRect = frame?.nodeType === Node.ELEMENT_NODE
      ? (frame as Element).getBoundingClientRect()
      : null;
    const viewRect = options.getView()?.getBoundingClientRect();
    if (!viewRect?.width || !viewRect.height) return false;
    const x = (frameRect?.left ?? 0) + clientX - viewRect.left;
    const y = (frameRect?.top ?? 0) + clientY - viewRect.top;
    return x >= viewRect.width * TOUCH_CENTER_INSET_RATIO
      && x <= viewRect.width * (1 - TOUCH_CENTER_INSET_RATIO)
      && y >= viewRect.height * TOUCH_CENTER_INSET_RATIO
      && y <= viewRect.height * (1 - TOUCH_CENTER_INSET_RATIO);
  };

  const bindDragGesture = (target: EventTarget, sourceDocument: Document) => {
    let longPressTimer: number | undefined;
    let active = false;
    let selecting = false;
    let gestureAxis: "horizontal" | "vertical" | null = null;
    let suppressSyntheticClickUntil = 0;
    const clearLongPress = () => {
      if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
      longPressTimer = undefined;
    };
    const handleMouseClick = (event: Event) => {
      const click = event as MouseEvent;
      if (!eventBelongsToReader(click) || isInteractiveTarget(click)) return;
      if (performance.now() < suppressSyntheticClickUntil) return;
      const direction = edgeDirection(sourceDocument, click.clientX);
      if (!direction) return;

      const selection = sourceDocument.defaultView?.getSelection();
      if (selection && !selection.isCollapsed) return;
      consumeReaderEvent(click, "stop");
      dispatchStep(direction);
    };
    target.addEventListener("click", handleMouseClick, { capture: true });
    const drag = new DragGesture<PointerEvent>(target, (state) => {
      const event = state.event;
      const starting = state.first;
      const ending = state.last;
      if (starting) {
        if (state.canceled) return;
        active = false;
        selecting = false;
        gestureAxis = null;
        if (!eventBelongsToReader(event) || !event.isPrimary || event.button !== 0) {
          state.cancel();
          return;
        }
        const intent = claimReaderPointer(event);
        // A higher-priority owner still needs the browser's original pointer
        // sequence so it can receive its synthesized click.
        if (intent !== "content") return;
        active = true;
        inertia.stop();
        if (event.pointerType === "touch") {
          longPressTimer = window.setTimeout(() => {
            if (!state.intentional) selecting = true;
          }, TOUCH_LONG_PRESS_DELAY_MS);
        }
      }

      if (!active) {
        if (ending) consumeReaderPointerClaim(event);
        return;
      }
      if (state.intentional) clearLongPress();
      if (selecting) {
        if (ending) {
          active = false;
          clearLongPress();
          consumeReaderPointerClaim(event);
        }
        return;
      }
      if (ending) {
        active = false;
        clearLongPress();
        if (event.pointerType === "touch") suppressSyntheticClickUntil = performance.now() + 500;
        const intent = consumeReaderPointerClaim(event);
        if (intent && intent !== "content") return;
        if (state.canceled || event.type === "pointercancel") return;
        if (state.tap) {
          const selection = sourceDocument.defaultView?.getSelection();
          if (selection && !selection.isCollapsed) return;
          if (event.pointerType !== "mouse" && isCenterTap(sourceDocument, event.clientX, event.clientY)) {
            consumeReaderEvent(event, "stop");
            options.dispatchCommand("toggle-dock");
          }
        } else if (event.pointerType !== "mouse"
          && (options.getFlow() === "paginated" ? gestureAxis === "horizontal" : gestureAxis === "vertical")) {
          const velocityX = -state.direction[0] * state.velocity[0];
          const velocityY = -state.direction[1] * state.velocity[1];
          if (options.getFlow() === "paginated") options.getView()?.renderer?.settle?.(velocityX, velocityY);
          else inertia.start(velocityY);
        }
        return;
      }
      if (!state.intentional || event.pointerType === "mouse") return;

      if (!gestureAxis) {
        const [movementX, movementY] = state.movement;
        if (Math.abs(movementX) >= Math.abs(movementY) * TOUCH_AXIS_RATIO) gestureAxis = "horizontal";
        else if (Math.abs(movementY) >= Math.abs(movementX) * TOUCH_AXIS_RATIO) gestureAxis = "vertical";
        else return;
      }

      const expectedAxis = options.getFlow() === "paginated" ? "horizontal" : "vertical";
      if (gestureAxis !== expectedAxis) return;

      consumeReaderEvent(event, "stop");
      const dx = -state.delta[0];
      const dy = -state.delta[1];
      if (options.getFlow() === "scrolled") options.getNavigation()?.scrollBy(dy);
      else options.getView()?.renderer?.panBy?.(dx, dy);
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
      target.removeEventListener("click", handleMouseClick, { capture: true });
      drag.destroy();
    };
  };

  const bindWheelGesture = (targetDocument: Document) => {
    const wheel = WheelGestures({ preventWheelAction: false });
    let swipeConsumed = false;
    const stopListening = wheel.on("wheel", (state) => {
      if (state.isStart) {
        inertia.stop();
        activeWheelTargets.add(targetDocument);
        swipeConsumed = false;
        if (!wheelBoundaryInFlight) wheelBoundaryConsumed = false;
      }
      if (state.isEnding || state.isMomentumCancel) {
        activeWheelTargets.delete(targetDocument);
        swipeConsumed = false;
        if (!activeWheelTargets.size && !wheelBoundaryInFlight) {
          wheelBoundaryConsumed = false;
        }
        if (state.isMomentumCancel) inertia.stop();
        return;
      }

      const event = state.event as WheelEvent;
      if (!eventBelongsToReader(event) || event.ctrlKey || event.metaKey) return;
      const [axisX, axisY] = state.axisDelta;
      const deltaX = -axisX;
      const deltaY = -axisY;
      const isHorizontal = Math.abs(deltaX) >= Math.abs(deltaY) * WHEEL_SWIPE_AXIS_RATIO;
      if (isHorizontal) consumeReaderEvent(event);

      if (!state.isMomentum && !swipeConsumed && event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
        const [movementX, movementY] = state.axisMovement;
        const [velocityX] = state.axisVelocity;
        const isHorizontalSwipe = Math.abs(movementX) >= WHEEL_SWIPE_MIN_DISTANCE
          && Math.abs(movementX) >= Math.abs(movementY) * WHEEL_SWIPE_AXIS_RATIO
          && Math.abs(velocityX) >= WHEEL_SWIPE_MIN_VELOCITY;
        if (isHorizontalSwipe) {
          swipeConsumed = true;
          suppressWheelScroll();
          dispatchStep(movementX < 0 ? "left" : "right");
          return;
        }
      }

      if (options.getFlow() !== "scrolled" || isWheelScrollSuppressed() || isHorizontal) return;
      const rawDelta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
      const delta = rawDelta * WHEEL_SCROLL_GAIN;
      const direction = Math.sign(delta);
      if (!direction) return;
      consumeReaderEvent(event);
      if (state.isMomentum) inertia.stop();
      const coarse = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
        || Math.abs(delta) >= COARSE_WHEEL_DELTA_PX;
      if (!state.isMomentum && coarse) inertia.pushDistance(delta);
      else scrollWheelBy(delta);
    });
    const stopObserving = wheel.observe(targetDocument);
    return () => {
      activeWheelTargets.delete(targetDocument);
      stopObserving();
      stopListening();
      wheel.disconnect();
    };
  };

  const bindSideButtonNavigation = (targetDocument: Document) => {
    let pressedButton: 3 | 4 | null = null;
    let trackingMove = false;

    function stopSideButtonEvent(event: MouseEvent | PointerEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      consumeReaderEvent(event, "immediate");
    }
    function handlePointerMove(event: PointerEvent) {
      if (event.buttons & 24) consumeReaderEvent(event, "immediate");
      else stopTracking();
    }
    function startTracking() {
      if (trackingMove) return;
      trackingMove = true;
      targetDocument.addEventListener("pointermove", handlePointerMove, { capture: true });
    }
    function stopTracking() {
      pressedButton = null;
      if (!trackingMove) return;
      trackingMove = false;
      targetDocument.removeEventListener("pointermove", handlePointerMove, { capture: true });
    }
    function handleMouseDown(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      stopSideButtonEvent(event);
      pressedButton = event.button;
      startTracking();
    }
    function handleMouseUp(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      stopSideButtonEvent(event);
      const shouldNavigate = pressedButton === event.button;
      stopTracking();
      if (shouldNavigate) {
        options.dispatchCommand(event.button === 3 ? "paginate-previous" : "paginate-next");
      }
    }
    const targetWindow = targetDocument.defaultView;

    targetDocument.addEventListener("mousedown", handleMouseDown, { capture: true });
    targetDocument.addEventListener("mouseup", handleMouseUp, { capture: true });
    targetDocument.addEventListener("auxclick", stopSideButtonEvent, { capture: true });
    targetWindow?.addEventListener("blur", stopTracking);
    return () => {
      stopTracking();
      targetDocument.removeEventListener("mousedown", handleMouseDown, { capture: true });
      targetDocument.removeEventListener("mouseup", handleMouseUp, { capture: true });
      targetDocument.removeEventListener("auxclick", stopSideButtonEvent, { capture: true });
      targetWindow?.removeEventListener("blur", stopTracking);
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
    const stopDrag = targetDocument === document
      ? () => {}
      : bindDragGesture(targetDocument, targetDocument);
    const stopWheel = bindWheelGesture(targetDocument);
    const stopSideButtons = bindSideButtonNavigation(targetDocument);
    inputTargets.set(targetDocument, () => {
      stopDrag();
      stopWheel();
      stopSideButtons();
      targetDocument.removeEventListener("keydown", handleKeyDown);
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
      inertia.stop();
      activeWheelTargets.clear();
      clearWheelBoundary();
      bindings.forEach((_, view) => unbindReaderView(view));
      inputTargets.forEach((dispose) => dispose());
      inputTargets.clear();
    },
    scrollByKey,
    executeStep,
    executePaginate,
    unbindReaderView,
  };
}
