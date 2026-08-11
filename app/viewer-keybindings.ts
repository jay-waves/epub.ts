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

function isEditableTarget(target: EventTarget | null) {
  if (!target || (target as Node).nodeType !== Node.ELEMENT_NODE) return false;
  const element = target as HTMLElement;
  return element.isContentEditable || Boolean(element.closest(
    "input, select, textarea, button, summary, audio, video, a[href], [role='slider'], [contenteditable]:not([contenteditable='false'])",
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

type ViewerKeybindingOptions = {
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

export function setupViewerKeybindings(options: ViewerKeybindingOptions) {
  const keyTargets = new Map<Document, () => void>();
  const bindings = new Map<ReaderView, {
    documents: Set<Document>;
    onLoad: EventListener;
    onUnload: EventListener;
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
    const renderer = options.getView()?.renderer;
    const { end, start, viewSize } = renderer ?? {};
    if (!renderer || typeof end !== "number" || typeof start !== "number" || typeof viewSize !== "number") return null;
    return { end, renderer, start, viewSize };
  };

  const signalScrollEdge = (direction: number) => {
    if (isWheelScrollSuppressed()) return;
    if (options.getFlow() === "scrolled") options.onScrollEdge(direction);
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
  };

  const handleWheel = (event: WheelEvent) => {
    if (options.getFlow() !== "scrolled") return;
    if (isWheelScrollSuppressed()) return;

    const direction = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? Math.sign(event.deltaY)
      : Math.sign(event.deltaX);
    if (!direction) return;

    const metrics = getSectionScrollMetrics();
    if (!metrics) return;
    const remaining = direction < 0 ? metrics.start : metrics.viewSize - metrics.end;
    if (remaining <= SECTION_EDGE_EPSILON) signalScrollEdge(direction);
  };

  const stopWheelListener = wheelGestures.on("wheel", (state) => {
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
    targetDocument.addEventListener("keydown", handleKeyDown);
    targetDocument.addEventListener("keyup", handleKeyUp);
    targetDocument.addEventListener("wheel", handleWheel, { passive: true });
    targetDocument.defaultView?.addEventListener("blur", handleBlur);
    const stopObservingWheel = wheelGestures.observe(targetDocument);
    keyTargets.set(targetDocument, () => {
      stopObservingWheel();
      targetDocument.removeEventListener("keydown", handleKeyDown);
      targetDocument.removeEventListener("keyup", handleKeyUp);
      targetDocument.removeEventListener("wheel", handleWheel);
      targetDocument.defaultView?.removeEventListener("blur", handleBlur);
    });
  };

  const unbindKeyTarget = (targetDocument: Document) => {
    keyTargets.get(targetDocument)?.();
    keyTargets.delete(targetDocument);
  };

  const bindReaderView = (view: ReaderView) => {
    if (bindings.has(view)) return;
    const documents = new Set<Document>();
    const bindDocument = (doc: Document) => {
      documents.add(doc);
      bindKeyTarget(doc);
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
      unbindKeyTarget(doc);
    };
    view.addEventListener("load", onLoad);
    view.addEventListener("unload", onUnload);
    bindings.set(view, { documents, onLoad, onUnload });
  };

  const unbindReaderView = (view: ReaderView) => {
    const binding = bindings.get(view);
    if (!binding) return;
    view.removeEventListener("load", binding.onLoad);
    view.removeEventListener("unload", binding.onUnload);
    binding.documents.forEach(unbindKeyTarget);
    bindings.delete(view);
  };

  bindKeyTarget(document);
  return {
    bindReaderView,
    destroy: () => {
      stopHoldScroll();
      bindings.forEach((_, view) => unbindReaderView(view));
      keyTargets.forEach((dispose) => dispose());
      keyTargets.clear();
      stopWheelListener();
      wheelGestures.disconnect();
    },
    turnPage,
    unbindReaderView,
  };
}
