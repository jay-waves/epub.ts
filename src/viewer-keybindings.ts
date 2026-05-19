import type { FoliateViewElement } from "./viewer-types";

const SCROLL_KEY_DISTANCE_RATIO = 0.48;
const HOLD_SCROLL_SPEED_RATIO = 1.75;
const HOLD_SCROLL_DELAY_MS = 180;
const SECTION_EDGE_EPSILON = 2;

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
  return key === "ArrowDown" || key === "j";
}

export function setupViewerKeybindings(options: {
  getReaderView: () => FoliateViewElement | null;
  getFlow: () => "paginated" | "scrolled";
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

  const scrollCurrentSectionWithBounds = (direction: number, distance: number) => {
    const metrics = getSectionScrollMetrics();
    if (!metrics) return;

    const remaining = getRemainingSectionDistance(direction);
    if (remaining <= SECTION_EDGE_EPSILON) return;

    void (direction < 0 ? metrics.renderer.prev?.(Math.min(distance, remaining)) : metrics.renderer.next?.(Math.min(distance, remaining)));
  };

  const goLeft = () => {
    const readerView = options.getReaderView();
    if (options.getFlow() === "paginated") {
      void readerView?.goLeft?.();
      return;
    }

    const isRtl = readerView?.book?.dir === "rtl";
    void (isRtl ? readerView?.renderer?.nextSection?.() : readerView?.renderer?.prevSection?.());
  };

  const goRight = () => {
    const readerView = options.getReaderView();
    if (options.getFlow() === "paginated") {
      void readerView?.goRight?.();
      return;
    }

    const isRtl = readerView?.book?.dir === "rtl";
    void (isRtl ? readerView?.renderer?.prevSection?.() : readerView?.renderer?.nextSection?.());
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
      goLeft();
    } else if (event.key === "ArrowRight" || event.key === "l") {
      event.preventDefault();
      goRight();
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

  const bindKeyTarget = (targetDocument: Document) => {
    if (keyTargets.has(targetDocument)) return;
    keyTargets.add(targetDocument);
    targetDocument.addEventListener("keydown", handleKeyDown);
    targetDocument.addEventListener("keyup", handleKeyUp);
    targetDocument.defaultView?.addEventListener("blur", handleBlur);
  };

  const bindReaderView = (view: FoliateViewElement) => {
    if (boundReaderViews.has(view)) return;
    boundReaderViews.add(view);
    view.addEventListener("load", (event) => {
      const detail = (event as CustomEvent<{ doc?: Document }>).detail;
      if (detail?.doc) bindKeyTarget(detail.doc);
    });
  };

  bindKeyTarget(document);

  return { bindReaderView };
}
