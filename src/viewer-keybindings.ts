import { WheelGestures } from "wheel-gestures";
import { listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import type { PageTurnDirection } from "./viewer-events";
import type { FoliateViewElement } from "./viewer-types";

const SCROLL_KEY_DISTANCE_RATIO = 0.48;
const HOLD_SCROLL_SPEED_RATIO = 1.75;
const HOLD_SCROLL_DELAY_MS = 180;
const SECTION_EDGE_EPSILON = 2;
const WHEEL_SWIPE_AXIS_RATIO = 1.35;
const WHEEL_SWIPE_MIN_DISTANCE = 42;
const WHEEL_SWIPE_MIN_VELOCITY = 0.32;
const WHEEL_SWIPE_SUPPRESS_SCROLL_MS = 1200;

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "select" || tagName === "textarea";
}

function getKeyboardScrollDistance() {
  return Math.max(120, Math.round(window.innerHeight * SCROLL_KEY_DISTANCE_RATIO));
}

function isScrollUpKey(key: string) {
  return key === "ArrowUp" || key === "k";
}

function isScrollDownKey(key: string) {
  return key === "ArrowDown" || key === "j" || key === " " || key === "Spacebar";
}

export function setupViewerKeybindings(options: {
  getReaderView: () => FoliateViewElement | null;
  getFlow: () => "paginated" | "scrolled";
  canTurnPage?: () => boolean;
  beforeSectionTurn?: () => void;
  afterSectionTurn?: () => void;
  onScrollEdge?: (direction: number) => void;
  openSearch: () => void;
  closeSearch: () => void;
}) {
  const keyTargets = new WeakSet<Document>();
  const boundReaderViews = new WeakSet<FoliateViewElement>();
  let pressedScrollKey: string | null = null;
  let holdScrollDelayTimer: number | undefined;
  let holdScrollDirection = 0;
  let holdScrollFrame: number | undefined;
  let holdScrollLastTime = 0;
  let holdScrollRefreshingBounds = false;
  let sectionTurnInFlight = false;
  let wheelSwipeConsumed = false;
  let suppressWheelScrollUntil = 0;
  const wheelGestures = WheelGestures({ preventWheelAction: "x" });

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
    const renderer = options.getReaderView()?.renderer;
    const { end, start, viewSize } = renderer ?? {};
    if (!renderer || typeof end !== "number" || typeof start !== "number" || typeof viewSize !== "number") return null;
    return { end, renderer, start, viewSize };
  };

  const getRemainingSectionDistance = (direction: number) => {
    const metrics = getSectionScrollMetrics();
    if (!metrics) return 0;
    return direction < 0 ? metrics.start : metrics.viewSize - metrics.end;
  };

  const signalScrollEdge = (direction: number) => {
    if (isWheelScrollSuppressed()) return;
    if (options.getFlow() === "scrolled") options.onScrollEdge?.(direction);
  };

  const scrollCurrentSectionWithBounds = (direction: number, distance: number) => {
    const metrics = getSectionScrollMetrics();
    if (!metrics) return;

    const remaining = getRemainingSectionDistance(direction);
    if (remaining <= SECTION_EDGE_EPSILON) {
      signalScrollEdge(direction);
      return;
    }

    void (direction < 0 ? metrics.renderer.prev?.(Math.min(distance, remaining)) : metrics.renderer.next?.(Math.min(distance, remaining)));
  };

  const turnReaderSection = (direction: PageTurnDirection) => {
    if (sectionTurnInFlight) return;

    const readerView = options.getReaderView();
    const renderer = readerView?.renderer;
    if (!renderer) return;

    const isRtl = readerView?.book?.dir === "rtl";
    const shouldGoNext = direction === "left" ? isRtl : !isRtl;
    const isBookEdge = shouldGoNext ? renderer.atEnd : renderer.atStart;
    if (isBookEdge) {
      signalScrollEdge(shouldGoNext ? 1 : -1);
      return;
    }

    suppressWheelScroll();
    options.beforeSectionTurn?.();
    sectionTurnInFlight = true;
    const turn = shouldGoNext ? renderer.nextSection?.() : renderer.prevSection?.();
    void Promise.resolve(turn)
      .catch((error) => {
        console.warn("Failed to turn reader section.", error);
      })
      .finally(() => {
        sectionTurnInFlight = false;
        options.afterSectionTurn?.();
      });
  };

  const turnPage = (direction: PageTurnDirection) => {
    if (options.canTurnPage && !options.canTurnPage()) return;

    const readerView = options.getReaderView();
    if (options.getFlow() === "paginated") {
      const isRtl = readerView?.book?.dir === "rtl";
      const shouldGoNext = direction === "left" ? isRtl : !isRtl;
      const isSectionEdge = shouldGoNext ? readerView?.renderer?.atEnd : readerView?.renderer?.atStart;
      if (isSectionEdge) options.beforeSectionTurn?.();
      void (direction === "left" ? readerView?.goLeft?.() : readerView?.goRight?.());
      return;
    }

    turnReaderSection(direction);
  };

  const refreshHoldScrollBounds = async () => {
    const metrics = getSectionScrollMetrics();
    if (!metrics?.renderer.scrollToAnchor || metrics.viewSize <= 0) return;

    holdScrollRefreshingBounds = true;
    holdScrollFrame = undefined;
    await metrics.renderer.scrollToAnchor(metrics.start / metrics.viewSize);
    holdScrollRefreshingBounds = false;
    holdScrollLastTime = 0;

    if (holdScrollDirection && options.getFlow() === "scrolled") {
      holdScrollFrame = window.requestAnimationFrame(stepHoldScroll);
    }
  };

  const stepHoldScroll = (time: number) => {
    const readerView = options.getReaderView();
    const renderer = readerView?.renderer;
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
    renderer.scrollBy(scrollDelta, scrollDelta);
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
    if (event.key === "Escape") {
      event.preventDefault();
      options.closeSearch();
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
      event.preventDefault();
      options.openSearch();
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
  };

  const handleWheel = (event: WheelEvent) => {
    if (options.getFlow() !== "scrolled") return;
    if (isWheelScrollSuppressed()) return;

    const direction = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? Math.sign(event.deltaY)
      : Math.sign(event.deltaX);
    if (!direction) return;

    const remaining = getRemainingSectionDistance(direction);
    if (remaining <= SECTION_EDGE_EPSILON) signalScrollEdge(direction);
  };

  wheelGestures.on("wheel", (state) => {
    if (state.isStart || state.isEnding || state.isMomentumCancel) resetWheelSwipe();
    if (state.isEnding || state.isMomentum || wheelSwipeConsumed) return;

    const event = state.event;
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

  const bindKeyTarget = (targetDocument: Document) => {
    if (keyTargets.has(targetDocument)) return;
    keyTargets.add(targetDocument);
    targetDocument.addEventListener("keydown", handleKeyDown);
    targetDocument.addEventListener("keyup", handleKeyUp);
    targetDocument.addEventListener("wheel", handleWheel, { passive: true });
    targetDocument.defaultView?.addEventListener("blur", handleBlur);
    wheelGestures.observe(targetDocument);
  };

  const bindReaderView = (view: FoliateViewElement) => {
    if (boundReaderViews.has(view)) return;
    boundReaderViews.add(view);
    view.renderer?.getContents?.().forEach((content) => {
      if (content.doc) bindKeyTarget(content.doc);
    });
    view.addEventListener("load", (event) => {
      const detail = (event as CustomEvent<{ doc?: Document }>).detail;
      if (detail?.doc) bindKeyTarget(detail.doc);
    });
  };

  bindKeyTarget(document);
  listenViewerEvent(VIEWER_EVENTS.pageTurn, turnPage);

  return { bindReaderView };
}
