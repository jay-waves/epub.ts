import { WheelGestures } from "wheel-gestures";
import type { PageTurnDirection, ReaderView } from "./reader/model";
import type { Navigation } from "./reader/navigation";

const SCROLL_KEY_DISTANCE_RATIO = 0.48;
const HOLD_SCROLL_SPEED_RATIO = 1.75;
const HOLD_SCROLL_DELAY_MS = 180;
const SECTION_EDGE_EPSILON = 2;
const WHEEL_SWIPE_AXIS_RATIO = 1.35;
const WHEEL_SWIPE_MIN_DISTANCE = 42;
const WHEEL_SWIPE_MIN_VELOCITY = 0.32;
const WHEEL_SWIPE_SUPPRESS_SCROLL_MS = 1200;
const WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX = 24;
const WHEEL_SCROLL_COMPRESSION_RATIO = 0.25;
const WHEEL_DISCRETE_DELTA_THRESHOLD_PX = 48;
const WHEEL_SMOOTHING_FACTOR = 0.32;
const TOUCH_PAN_THRESHOLD_PX = 8;
const TOUCH_LONG_PRESS_DELAY_MS = 500;
const TOUCH_EDGE_RATIO = 0.22;
const TOUCH_INERTIA_MIN_VELOCITY = 0.08;
const TOUCH_INERTIA_MAX_VELOCITY = 2.5;
const TOUCH_INERTIA_STOP_VELOCITY = 0.02;
const TOUCH_INERTIA_TIME_CONSTANT_MS = 240;

type PointerGesture = {
  document: Document;
  pointerId: number;
  pointerType: string;
  lastX: number;
  lastY: number;
  lastTime: number;
  startX: number;
  startY: number;
  moved: boolean;
  mode: "pending" | "pan" | "selection";
  longPressTimer?: number;
  velocityX: number;
  velocityY: number;
};

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

function wheelDeltaInPixels(delta: number, event: WheelEvent, pageSize: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize;
  return delta;
}

function compressWheelDelta(delta: number) {
  const magnitude = Math.abs(delta);
  if (magnitude <= WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX) return delta;
  return Math.sign(delta) * (
    WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX
    + (magnitude - WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX) * WHEEL_SCROLL_COMPRESSION_RATIO
  );
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
  beforeSectionTurn: () => void;
  afterSectionTurn: () => void;
  onScrollEdge: (direction: number) => void;
  openSearch: () => boolean;
  closeSearch: () => boolean;
  saveBook: () => void;
};

/** Normalizes keyboard, wheel, and pointer input from both the shell and reader iframes. */
export function createViewerInput(options: ViewerInputOptions) {
  const inputTargets = new Map<Document, () => void>();
  const bindings = new Map<ReaderView, {
    documents: Set<Document>;
    onLoad: EventListener;
    onUnload: EventListener;
    previousTouchAction: string;
  }>();
  let pressedScrollKey: string | null = null;
  let holdScrollDelayTimer: number | undefined;
  let holdScrollDirection = 0;
  let holdScrollFrame: number | undefined;
  let holdScrollLastTime = 0;
  let holdScrollRefreshingBounds = false;
  let sectionTurnInFlight = false;
  let wheelSwipeConsumed = false;
  let suppressWheelScrollUntil = 0;
  let pointerGesture: PointerGesture | null = null;
  let inertiaFrame: number | undefined;
  let inertiaLastTime = 0;
  let inertiaVelocity = 0;
  let pendingWheelDelta = 0;
  let smoothWheelMotion = false;
  let wheelScrollFrame: number | undefined;
  const wheelGestures = WheelGestures({ preventWheelAction: "x" });

  const stopTouchInertia = () => {
    inertiaVelocity = 0;
    inertiaLastTime = 0;
    if (inertiaFrame !== undefined) {
      window.cancelAnimationFrame(inertiaFrame);
      inertiaFrame = undefined;
    }
  };

  const stopWheelMotion = () => {
    pendingWheelDelta = 0;
    smoothWheelMotion = false;
    if (wheelScrollFrame !== undefined) {
      window.cancelAnimationFrame(wheelScrollFrame);
      wheelScrollFrame = undefined;
    }
  };

  const stopHoldScroll = () => {
    if (holdScrollDelayTimer !== undefined) {
      window.clearTimeout(holdScrollDelayTimer);
      holdScrollDelayTimer = undefined;
    }
    holdScrollDirection = 0;
    holdScrollLastTime = 0;
    if (holdScrollFrame !== undefined) {
      window.cancelAnimationFrame(holdScrollFrame);
      holdScrollFrame = undefined;
    }
    holdScrollRefreshingBounds = false;
  };

  const resetWheelSwipe = () => {
    wheelSwipeConsumed = false;
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

  const stepWheelMotion = () => {
    wheelScrollFrame = undefined;
    if (options.getFlow() !== "scrolled" || Math.abs(pendingWheelDelta) < 0.01) {
      stopWheelMotion();
      return;
    }
    const metrics = getSectionScrollMetrics();
    if (!metrics) {
      stopWheelMotion();
      return;
    }
    const direction = Math.sign(pendingWheelDelta);
    const remaining = direction < 0 ? metrics.start : metrics.viewSize - metrics.end;
    if (remaining <= SECTION_EDGE_EPSILON) {
      signalScrollEdge(direction);
      stopWheelMotion();
      return;
    }
    const delta = smoothWheelMotion && Math.abs(pendingWheelDelta) >= 0.75
      ? pendingWheelDelta * WHEEL_SMOOTHING_FACTOR
      : pendingWheelDelta;
    const applied = Math.sign(delta) * Math.min(Math.abs(delta), remaining);
    pendingWheelDelta -= applied;
    options.getNavigation()?.scrollBy(applied);
    if (Math.abs(pendingWheelDelta) >= 0.01) {
      wheelScrollFrame = window.requestAnimationFrame(stepWheelMotion);
    } else {
      stopWheelMotion();
    }
  };

  const queueWheelMotion = (delta: number, smooth: boolean) => {
    pendingWheelDelta += delta;
    smoothWheelMotion ||= smooth;
    if (wheelScrollFrame === undefined) {
      wheelScrollFrame = window.requestAnimationFrame(stepWheelMotion);
    }
  };

  const scrollCurrentSectionWithBounds = (direction: number, distance: number) => {
    const metrics = getSectionScrollMetrics();
    if (!metrics) return;

    const remaining = direction < 0 ? metrics.start : metrics.viewSize - metrics.end;
    if (remaining <= SECTION_EDGE_EPSILON) {
      signalScrollEdge(direction);
      return;
    }

    const navigation = options.getNavigation();
    void (direction < 0
      ? navigation?.prev(Math.min(distance, remaining))
      : navigation?.next(Math.min(distance, remaining)));
  };

  const turnReaderSection = (direction: PageTurnDirection) => {
    if (sectionTurnInFlight) return;

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

    suppressWheelScroll();
    options.beforeSectionTurn();
    sectionTurnInFlight = true;
    const navigation = options.getNavigation();
    const turn = shouldGoNext ? navigation?.nextSection() : navigation?.previousSection();
    void Promise.resolve(turn)
      .catch((error) => {
        console.warn("Failed to turn reader section.", error);
      })
      .finally(() => {
        sectionTurnInFlight = false;
        options.afterSectionTurn();
      });
  };

  const turnPage = (direction: PageTurnDirection) => {
    if (!options.canTurnPage()) return;

    if (options.getFlow() === "paginated") {
      const navigation = options.getNavigation();
      void (direction === "left" ? navigation?.left() : navigation?.right())
        ?.catch((error) => console.warn("Failed to turn reader page.", error));
      return;
    }

    turnReaderSection(direction);
  };

  const refreshHoldScrollBounds = async () => {
    const metrics = getSectionScrollMetrics();
    if (!metrics?.renderer.scrollToAnchor || metrics.viewSize <= 0) return;

    holdScrollRefreshingBounds = true;
    holdScrollFrame = undefined;
    try {
      await options.getNavigation()?.scrollTo(metrics.start / metrics.viewSize);
    } catch (error) {
      console.warn("Failed to refresh reader scroll bounds.", error);
    } finally {
      holdScrollRefreshingBounds = false;
      holdScrollLastTime = 0;
    }

    if (holdScrollDirection && options.getFlow() === "scrolled") {
      holdScrollFrame = window.requestAnimationFrame(stepHoldScroll);
    }
  };

  const stepHoldScroll = (time: number) => {
    const view = options.getView();
    const renderer = view?.renderer;
    if (!holdScrollDirection || options.getFlow() !== "scrolled" || !renderer?.scrollBy) {
      stopHoldScroll();
      return;
    }

    if (holdScrollRefreshingBounds) {
      holdScrollFrame = undefined;
      return;
    }

    const metrics = getSectionScrollMetrics();
    if (!metrics) {
      stopHoldScroll();
      return;
    }

    const elapsed = holdScrollLastTime ? time - holdScrollLastTime : 16;
    holdScrollLastTime = time;
    const speed = Math.max(260, window.innerHeight * HOLD_SCROLL_SPEED_RATIO);
    const delta = holdScrollDirection * speed * (elapsed / 1000);
    const remaining = holdScrollDirection < 0 ? metrics.start : metrics.viewSize - metrics.end;
    if (remaining <= SECTION_EDGE_EPSILON) {
      signalScrollEdge(holdScrollDirection);
      stopHoldScroll();
      return;
    }

    const beforeStart = metrics.start;
    const scrollDelta = Math.sign(delta) * Math.min(Math.abs(delta), remaining);
    options.getNavigation()?.scrollBy(scrollDelta);
    const afterStart = renderer.start;
    if (typeof afterStart === "number" && Math.abs(afterStart - beforeStart) < 0.5) {
      void refreshHoldScrollBounds();
      return;
    }

    holdScrollFrame = window.requestAnimationFrame(stepHoldScroll);
  };

  const startHoldScroll = (direction: number) => {
    holdScrollDirection = direction;
    if (holdScrollFrame === undefined) {
      holdScrollFrame = window.requestAnimationFrame(stepHoldScroll);
    }
  };

  const scheduleHoldScroll = (key: string, direction: number) => {
    pressedScrollKey = key;
    if (holdScrollDelayTimer !== undefined) return;

    holdScrollDelayTimer = window.setTimeout(() => {
      holdScrollDelayTimer = undefined;
      if (pressedScrollKey === key) startHoldScroll(direction);
    }, HOLD_SCROLL_DELAY_MS);
  };

  const handleScrollKeyDown = (event: KeyboardEvent, direction: number) => {
    event.preventDefault();
    if (pressedScrollKey === event.key || holdScrollDirection) return;

    scheduleHoldScroll(event.key, direction);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    stopTouchInertia();
    stopWheelMotion();
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
      turnPage("left");
    } else if (event.key === "ArrowRight" || event.key === "l") {
      event.preventDefault();
      turnPage("right");
    } else if (options.getFlow() === "scrolled" && isScrollUpKey(event.key)) {
      handleScrollKeyDown(event, -1);
    } else if (options.getFlow() === "scrolled" && isScrollDownKey(event.key)) {
      handleScrollKeyDown(event, 1);
    } else if (event.key === "/") {
      if (options.openSearch()) event.preventDefault();
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (isScrollUpKey(event.key) || isScrollDownKey(event.key)) {
      const direction = isScrollUpKey(event.key) ? -1 : 1;
      const shouldRunShortScroll = pressedScrollKey === event.key && !holdScrollDirection;
      pressedScrollKey = null;
      stopHoldScroll();
      if (shouldRunShortScroll) scrollCurrentSectionWithBounds(direction, getKeyboardScrollDistance());
    }
  };

  const handleBlur = () => {
    pressedScrollKey = null;
    stopHoldScroll();
    stopTouchInertia();
    stopWheelMotion();
  };

  const handleWheel = (event: WheelEvent) => {
    if (!eventBelongsToReader(event)) return;
    if (options.getFlow() !== "scrolled" || event.ctrlKey || event.metaKey) return;
    if (isWheelScrollSuppressed()) return;
    stopTouchInertia();

    const deltaX = wheelDeltaInPixels(event.deltaX, event, window.innerWidth);
    const deltaY = wheelDeltaInPixels(event.deltaY, event, window.innerHeight);
    if (Math.abs(deltaX) >= Math.abs(deltaY) * WHEEL_SWIPE_AXIS_RATIO) return;
    const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
    const direction = Math.sign(delta);
    if (!direction) return;
    event.preventDefault();

    const isDiscreteWheel = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
      || Math.abs(delta) >= WHEEL_DISCRETE_DELTA_THRESHOLD_PX;
    queueWheelMotion(isDiscreteWheel ? compressWheelDelta(delta) : delta, isDiscreteWheel);
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

  const clearPointerGesture = () => {
    if (pointerGesture?.longPressTimer !== undefined) {
      window.clearTimeout(pointerGesture.longPressTimer);
    }
    pointerGesture = null;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!eventBelongsToReader(event)) return;
    if (!event.isPrimary || event.button !== 0 || isInteractiveTarget(event.target)) return;
    stopTouchInertia();
    stopWheelMotion();
    const targetDocument = event.currentTarget as Document;
    pointerGesture = {
      document: targetDocument,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      mode: "pending",
      velocityX: 0,
      velocityY: 0,
    };
    if (event.pointerType === "touch") {
      const pointerId = event.pointerId;
      pointerGesture.longPressTimer = window.setTimeout(() => {
        if (pointerGesture?.pointerId === pointerId && pointerGesture.mode === "pending") {
          pointerGesture.mode = "selection";
        }
      }, TOUCH_LONG_PRESS_DELAY_MS);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const gesture = pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.mode === "selection") return;
    const totalX = event.clientX - gesture.startX;
    const totalY = event.clientY - gesture.startY;
    if (!gesture.moved && totalX * totalX + totalY * totalY < TOUCH_PAN_THRESHOLD_PX ** 2) return;
    if (gesture.pointerType === "mouse") {
      clearPointerGesture();
      return;
    }
    if (gesture.mode === "pending") {
      if (gesture.longPressTimer !== undefined) window.clearTimeout(gesture.longPressTimer);
      gesture.longPressTimer = undefined;
      gesture.mode = "pan";
    }
    gesture.moved = true;
    event.preventDefault();
    event.stopPropagation();

    const dx = gesture.lastX - event.clientX;
    const dy = gesture.lastY - event.clientY;
    const elapsed = Math.max(1, event.timeStamp - gesture.lastTime);
    gesture.velocityX = dx / elapsed;
    gesture.velocityY = dy / elapsed;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.lastTime = event.timeStamp;

    if (options.getFlow() === "scrolled") options.getNavigation()?.scrollBy(dy);
    else options.getView()?.renderer?.scrollBy?.(dx, dy);
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

  const handlePointerEnd = (event: PointerEvent) => {
    const gesture = pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    clearPointerGesture();
    if (event.type === "pointercancel" || gesture.mode === "selection") return;
    if (gesture.moved) {
      if (options.getFlow() === "paginated") {
        options.getView()?.renderer?.settle?.(gesture.velocityX, gesture.velocityY);
      } else {
        startTouchInertia(gesture.velocityY);
      }
      return;
    }
    const direction = edgeDirection(gesture.document, event.clientX);
    if (direction) {
      event.preventDefault();
      event.stopPropagation();
      turnPage(direction);
    }
  };

  const stopWheelListener = wheelGestures.on("wheel", (state) => {
    if (state.isStart || state.isEnding || state.isMomentumCancel) resetWheelSwipe();
    if (state.isEnding || state.isMomentum || wheelSwipeConsumed) return;

    const event = state.event;
    if (!eventBelongsToReader(event)) return;
    if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || event.ctrlKey) return;

    const [movementX, movementY] = state.axisMovement;
    const [velocityX] = state.axisVelocity;
    const absMovementX = Math.abs(movementX);
    const absMovementY = Math.abs(movementY);
    const isClearHorizontalIntent = absMovementX >= WHEEL_SWIPE_MIN_DISTANCE
      && absMovementX >= absMovementY * WHEEL_SWIPE_AXIS_RATIO
      && Math.abs(velocityX) >= WHEEL_SWIPE_MIN_VELOCITY;
    if (!isClearHorizontalIntent) return;

    wheelSwipeConsumed = true;
    suppressWheelScroll();
    const direction = movementX < 0 ? "left" : "right";
    if (options.getFlow() === "scrolled") {
      turnReaderSection(direction);
      return;
    }

    turnPage(direction);
  });

  const bindInputTarget = (targetDocument: Document) => {
    if (inputTargets.has(targetDocument)) return;
    const touchStyle = targetDocument === document ? null : targetDocument.createElement("style");
    if (touchStyle) {
      touchStyle.textContent = "html { touch-action: pinch-zoom !important; }";
      targetDocument.head?.append(touchStyle);
    }
    targetDocument.addEventListener("keydown", handleKeyDown);
    targetDocument.addEventListener("keyup", handleKeyUp);
    targetDocument.addEventListener("wheel", handleWheel, { passive: false });
    targetDocument.addEventListener("pointerdown", handlePointerDown, { capture: true });
    targetDocument.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    targetDocument.addEventListener("pointerup", handlePointerEnd, { capture: true });
    targetDocument.addEventListener("pointercancel", handlePointerEnd, { capture: true });
    targetDocument.defaultView?.addEventListener("blur", handleBlur);
    const stopObservingWheel = wheelGestures.observe(targetDocument);
    inputTargets.set(targetDocument, () => {
      stopObservingWheel();
      targetDocument.removeEventListener("keydown", handleKeyDown);
      targetDocument.removeEventListener("keyup", handleKeyUp);
      targetDocument.removeEventListener("wheel", handleWheel);
      targetDocument.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      targetDocument.removeEventListener("pointermove", handlePointerMove, { capture: true });
      targetDocument.removeEventListener("pointerup", handlePointerEnd, { capture: true });
      targetDocument.removeEventListener("pointercancel", handlePointerEnd, { capture: true });
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
    const documents = new Set<Document>();
    const previousTouchAction = view.style.touchAction;
    view.style.touchAction = "pinch-zoom";
    const bindDocument = (doc: Document) => {
      documents.add(doc);
      bindInputTarget(doc);
    };
    view.renderer?.getContents?.().forEach((content) => {
      if (content.doc) bindDocument(content.doc);
    });
    const onLoad: EventListener = (event) => {
      const detail = (event as CustomEvent<{ doc?: Document }>).detail;
      if (detail?.doc) bindDocument(detail.doc);
    };
    const onUnload: EventListener = (event) => {
      const doc = (event as CustomEvent<{ doc?: Document }>).detail?.doc;
      if (!doc) return;
      documents.delete(doc);
      unbindInputTarget(doc);
    };
    view.addEventListener("load", onLoad);
    view.addEventListener("unload", onUnload);
    bindings.set(view, { documents, onLoad, onUnload, previousTouchAction });
  };

  const unbindReaderView = (view: ReaderView) => {
    const binding = bindings.get(view);
    if (!binding) return;
    view.removeEventListener("load", binding.onLoad);
    view.removeEventListener("unload", binding.onUnload);
    binding.documents.forEach(unbindInputTarget);
    if (binding.previousTouchAction) view.style.touchAction = binding.previousTouchAction;
    else view.style.removeProperty("touch-action");
    bindings.delete(view);
  };

  bindInputTarget(document);
  return {
    bindReaderView,
    destroy: () => {
      clearPointerGesture();
      stopHoldScroll();
      stopTouchInertia();
      stopWheelMotion();
      bindings.forEach((_, view) => unbindReaderView(view));
      inputTargets.forEach((dispose) => dispose());
      inputTargets.clear();
      stopWheelListener();
      wheelGestures.disconnect();
    },
    turnPage,
    unbindReaderView,
  };
}
