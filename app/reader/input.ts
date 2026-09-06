import { overlayInput, overlayInputEvents } from "./overlay-input";
import { WheelGestures } from "wheel-gestures";
import type { ReadingDirection, StepDirection } from "./model";
import type { ReaderView } from "../renderer";
import type { Navigation } from "./navigation";
import { observeRenderedContent } from "./rendered-content";
import { KineticScroller } from "./kinetic-scroller";
import { PointerMotion } from "./pointer-motion";
import type { ReaderCommand } from "./ui/model";
import {
  claimReaderPointer,
  consumeReaderEvent,
  consumeReaderPointerClaim,
  resolveReaderPointerIntent,
} from "./interaction-arbiter";
import { getReaderTapRegion } from "./tap-region";

const SCROLL_KEY_DISTANCE_RATIO = 0.48;
const SECTION_EDGE_EPSILON = 2;
const COARSE_WHEEL_DELTA_PX = 32;
const WHEEL_SCROLL_GAIN = 1.4;
const WHEEL_SWIPE_AXIS_RATIO = 1.35;
const WHEEL_SWIPE_MIN_DISTANCE = 42;
const WHEEL_SWIPE_MIN_VELOCITY = 0.32;
const TOUCH_PAN_THRESHOLD_PX = 8;
const TOUCH_LONG_PRESS_DELAY_MS = 500;
const TOUCH_AXIS_RATIO = 1.2;
// A double-click selects a word only after its second click. Keep a content
// click pending long enough for that selection to win over page turning.
const DOUBLE_CLICK_DELAY_MS = 150;

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

function getKeyboardScrollDistance() {
  return Math.max(120, Math.round(window.innerHeight * SCROLL_KEY_DISTANCE_RATIO));
}

type ViewerInputOptions = {
  getView: () => ReaderView | null;
  getNavigation: () => Navigation | null;
  getFlow: () => "paginated" | "scrolled";
  canTurnPage: () => boolean;
  onChapterBoundary: (direction: ReadingDirection, pending: boolean) => void;
  onScrollEdge: (direction: ReadingDirection) => void;
  dispatchCommand: (command: ReaderCommand) => void;
  dispatchProgressReturn: () => void;
  dispatchProgressSeek: (progress: number) => void;
};

/** Normalizes keyboard, wheel, and pointer input from both the shell and reader iframes. */
export function createViewerInput(options: ViewerInputOptions) {
  const canTurnPage = () => !overlayInput.locked && options.canTurnPage();
  const inputTargets = new Map<Document, () => void>();
  const bindings = new Map<ReaderView, {
    previousTouchAction: string;
    stopDocuments: () => void;
    stopShellDrag: () => void;
  }>();
  let wheelBoundaryConsumed = false;
  let wheelBoundaryDirection: ReadingDirection | null = null;
  let progressPrefix = "";
  let wheelActive = false;
  const dispatchStep = (direction: StepDirection) => options.dispatchCommand(STEP_COMMANDS[direction]);

  const clearWheelBoundary = () => {
    if (wheelBoundaryDirection !== null) options.onChapterBoundary(wheelBoundaryDirection, false);
    wheelBoundaryDirection = null;
    if (!wheelActive) wheelBoundaryConsumed = false;
  };

  const crossWheelBoundary = (direction: ReadingDirection, distance: number) => {
    if (wheelBoundaryConsumed) return;
    wheelBoundaryConsumed = true;
    wheelBoundaryDirection = direction;
    options.onChapterBoundary(direction, true);
    const navigation = options.getNavigation();
    const crossing = direction < 0 ? navigation?.prev(distance) : navigation?.next(distance);
    void Promise.resolve(crossing)
      .catch((error) => console.warn("Failed to cross reader chapter boundary.", error))
      .finally(clearWheelBoundary);
  };

  const getSectionScrollMetrics = () => {
    const renderer = options.getView()?.renderer;
    if (!renderer || renderer.mode === "fixed") return null;
    const { end, start, viewSize } = renderer;
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

  const signalScrollEdge = (direction: ReadingDirection) => {
    if (options.getFlow() === "scrolled") options.onScrollEdge(direction);
  };

  const scrollWheelBy = (delta: number) => {
    if (!canTurnPage() || options.getFlow() !== "scrolled") return false;
    const metrics = getSectionScrollMetrics();
    if (!metrics) return false;
    if (!delta) return false;
    const direction: ReadingDirection = delta < 0 ? -1 : 1;
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
    canRun: () => canTurnPage() && options.getFlow() === "scrolled",
    scrollBy: scrollWheelBy,
  });
  const stopOverlayInput = overlayInput.subscribe(() => {
    inertia.stop();
    progressPrefix = "";
  });

  const scrollCurrentSectionWithBounds = (direction: ReadingDirection, distance: number) => {
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

  const turnInReadingOrder = (direction: ReadingDirection, wholePage = false) => {
    if (!canTurnPage()) return;
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

  const executePaginate = (direction: ReadingDirection) => turnInReadingOrder(direction, true);

  const scrollByKey = (direction: ReadingDirection) => {
    if (!canTurnPage()) return;
    scrollCurrentSectionWithBounds(direction, getKeyboardScrollDistance());
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    inertia.stop();
    if (overlayInput.locked) {
      progressPrefix = "";
      return;
    }
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

  const readerPoint = (sourceDocument: Document, clientX: number, clientY: number) => {
    const frame = sourceDocument.defaultView?.frameElement;
    const frameRect = frame?.nodeType === Node.ELEMENT_NODE
      ? (frame as Element).getBoundingClientRect()
      : null;
    const viewRect = options.getView()?.getBoundingClientRect();
    if (!viewRect?.width || !viewRect.height) return null;
    return {
      height: viewRect.height,
      width: viewRect.width,
      x: (frameRect?.left ?? 0) + clientX - viewRect.left,
      y: (frameRect?.top ?? 0) + clientY - viewRect.top,
    };
  };

  const tapRegion = (sourceDocument: Document, clientX: number, clientY: number) => {
    const point = readerPoint(sourceDocument, clientX, clientY);
    if (!point) return null;
    if (point.y < 0 || point.y > point.height) return null;
    return getReaderTapRegion(point.x, point.width);
  };

  const bindPointerInput = (target: EventTarget, sourceDocument: Document) => {
    type PointerSession = {
      claimEvent: PointerEvent;
      longPressTimer?: number;
      motion: PointerMotion;
      selecting: boolean;
    };
    const events = new AbortController();
    const targetWindow = sourceDocument.defaultView ?? window;
    let session: PointerSession | null = null;
    let mouseSelection: {
      pointerId: number;
      startX: number;
      startY: number;
      moved: boolean;
    } | null = null;
    let suppressMouseClick = false;
    let suppressMouseClickTimer: number | undefined;
    let pendingMouseClick: { event: MouseEvent; region: "left" | "right" } | null = null;
    let pendingMouseClickTimer: number | undefined;
    const clearPendingMouseClick = () => {
      if (pendingMouseClickTimer !== undefined) window.clearTimeout(pendingMouseClickTimer);
      pendingMouseClickTimer = undefined;
      pendingMouseClick = null;
    };
    const turnPendingMouseClick = () => {
      const pending = pendingMouseClick;
      clearPendingMouseClick();
      if (!pending || !canTurnPage()) return;
      const selection = sourceDocument.defaultView?.getSelection();
      if (selection && !selection.isCollapsed) return;
      consumeReaderEvent(pending.event, "stop");
      dispatchStep(pending.region);
    };
    const clickHitsSelectableText = (event: MouseEvent) => {
      const pointDocument = sourceDocument as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const range = pointDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
      const node = range?.startContainer
        ?? pointDocument.caretPositionFromPoint?.(event.clientX, event.clientY)?.offsetNode;
      if (!node || node.nodeType !== 3 || !node.textContent?.trim()) return false;
      const parent = node.parentElement;
      return Boolean(parent && sourceDocument.defaultView?.getComputedStyle(parent).userSelect !== "none");
    };
    const queueMouseClick = (event: MouseEvent, region: "left" | "right") => {
      if (pendingMouseClick) turnPendingMouseClick();
      pendingMouseClick = { event, region };
      pendingMouseClickTimer = window.setTimeout(turnPendingMouseClick, DOUBLE_CLICK_DELAY_MS);
    };
    const suppressNextMouseClick = () => {
      suppressMouseClick = true;
      if (suppressMouseClickTimer !== undefined) window.clearTimeout(suppressMouseClickTimer);
      suppressMouseClickTimer = window.setTimeout(() => {
        suppressMouseClick = false;
        suppressMouseClickTimer = undefined;
      }, 0);
    };
    const handleMousePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || resolveReaderPointerIntent(event.target) !== "content") return;
      claimReaderPointer(event, "content");
      mouseSelection = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    };
    const handleMousePointerMove = (event: PointerEvent) => {
      if (!mouseSelection || event.pointerId !== mouseSelection.pointerId) return;
      mouseSelection.moved ||= Math.max(
        Math.abs(event.clientX - mouseSelection.startX),
        Math.abs(event.clientY - mouseSelection.startY),
      ) >= 4;
    };
    const handleMousePointerEnd = (event: PointerEvent) => {
      if (!mouseSelection || event.pointerId !== mouseSelection.pointerId) return;
      const owner = consumeReaderPointerClaim(event);
      if (owner !== "content" || mouseSelection.moved) suppressNextMouseClick();
      mouseSelection = null;
    };
    const clearLongPress = (current: PointerSession) => {
      if (current.longPressTimer !== undefined) window.clearTimeout(current.longPressTimer);
      current.longPressTimer = undefined;
    };
    const endPointerSession = (current: PointerSession) => {
      session = null;
      clearLongPress(current);
      return consumeReaderPointerClaim(current.claimEvent);
    };
    const handleMouseClick = (event: Event) => {
      const click = event as MouseEvent;
      if (!canTurnPage()) {
        clearPendingMouseClick();
        return;
      }
      if (!eventBelongsToReader(click) || resolveReaderPointerIntent(click.target) !== "content") return;
      if ("pointerType" in click && (click as PointerEvent).pointerType !== "mouse") return;
      if (suppressMouseClick) {
        suppressMouseClick = false;
        if (suppressMouseClickTimer !== undefined) window.clearTimeout(suppressMouseClickTimer);
        suppressMouseClickTimer = undefined;
        clearPendingMouseClick();
        return;
      }
      const region = tapRegion(sourceDocument, click.clientX, click.clientY);
      if (options.getFlow() !== "paginated" || (region !== "left" && region !== "right")) return;

      // The second click of a double-click arrives with detail=2. Cancel the
      // queued single-click before the browser creates the text selection.
      if (click.detail > 1) {
        clearPendingMouseClick();
        return;
      }
      const selection = sourceDocument.defaultView?.getSelection();
      if (selection && !selection.isCollapsed) return;
      if (!clickHitsSelectableText(click)) {
        clearPendingMouseClick();
        consumeReaderEvent(click, "stop");
        dispatchStep(region);
        return;
      }
      queueMouseClick(click, region);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!canTurnPage() || !eventBelongsToReader(event) || !event.isPrimary) return;
      if (event.pointerType === "mouse") {
        handleMousePointerDown(event);
        return;
      }
      if (resolveReaderPointerIntent(event.target) !== "content") return;
      if (session) return;
      claimReaderPointer(event, "content");
      const current: PointerSession = {
        claimEvent: event,
        motion: new PointerMotion(event.clientX, event.clientY, event.timeStamp, {
          axisRatio: TOUCH_AXIS_RATIO,
          threshold: TOUCH_PAN_THRESHOLD_PX,
        }),
        selecting: false,
      };
      session = current;
      inertia.stop();
      if (event.pointerType === "touch") {
        current.longPressTimer = window.setTimeout(() => {
          if (session === current && !current.motion.moved) current.selecting = true;
        }, TOUCH_LONG_PRESS_DELAY_MS);
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      const current = session;
      if (!current || event.pointerId !== current.claimEvent.pointerId) return;
      const movement = current.motion.move(event.clientX, event.clientY, event.timeStamp);
      if (current.motion.moved) clearLongPress(current);
      if (current.selecting || !canTurnPage()) return;
      const expectedAxis = options.getFlow() === "paginated" ? "horizontal" : "vertical";
      if (movement.axis !== expectedAxis) return;
      consumeReaderEvent(event, "stop");
      const dx = -movement.deltaX;
      const dy = -movement.deltaY;
      if (options.getFlow() === "scrolled") options.getNavigation()?.scrollBy(dy);
      else options.getView()?.renderer?.panBy?.(dx, dy);
    };
    const handlePointerEnd = (event: PointerEvent) => {
      const current = session;
      if (!current || event.pointerId !== current.claimEvent.pointerId) return;
      const owner = endPointerSession(current);
      if (owner !== "content") return;
      if (current.selecting || !canTurnPage()) return;

      const flow = options.getFlow();
      const expectedAxis = flow === "paginated" ? "horizontal" : "vertical";
      if (event.type === "pointercancel") {
        if (flow === "paginated" && current.motion.axis === expectedAxis) {
          options.getView()?.renderer?.settle?.(0, 0);
        }
        return;
      }
      if (current.motion.isTap(event.clientX, event.clientY)) {
        const selection = sourceDocument.defaultView?.getSelection();
        if (selection && !selection.isCollapsed) return;
        const region = tapRegion(sourceDocument, event.clientX, event.clientY);
        if (!region) return;
        if (region !== "center" && flow !== "paginated") return;
        consumeReaderEvent(event, "stop");
        if (region === "center") options.dispatchCommand("toggle-dock");
        else dispatchStep(region);
        return;
      }
      if (current.motion.axis !== expectedAxis) return;
      const [pointerVelocityX, pointerVelocityY] = current.motion.velocity(event.timeStamp);
      const velocityX = -pointerVelocityX;
      const velocityY = -pointerVelocityY;
      if (flow === "paginated") options.getView()?.renderer?.settle?.(velocityX, velocityY);
      else inertia.start(velocityY);
    };

    // Opening an overlay invalidates input already in flight, even if it closes
    // before the delayed click or pointer release would otherwise run.
    const cancelPendingInput = () => {
      clearPendingMouseClick();
      mouseSelection = null;
      if (session) endPointerSession(session);
    };
    const stopOverlaySubscription = overlayInput.subscribe(cancelPendingInput);

    target.addEventListener("click", handleMouseClick, { capture: true, signal: events.signal });
    target.addEventListener("pointerdown", handlePointerDown as EventListener, {
      capture: true,
      signal: events.signal,
    });
    targetWindow.addEventListener("pointermove", handleMousePointerMove, {
      capture: true,
      signal: events.signal,
    });
    targetWindow.addEventListener("pointerup", handleMousePointerEnd, { capture: true, signal: events.signal });
    targetWindow.addEventListener("pointercancel", handleMousePointerEnd, {
      capture: true,
      signal: events.signal,
    });
    targetWindow.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: false,
      signal: events.signal,
    });
    targetWindow.addEventListener("pointerup", handlePointerEnd, { capture: true, signal: events.signal });
    targetWindow.addEventListener("pointercancel", handlePointerEnd, { capture: true, signal: events.signal });
    return () => {
      stopOverlaySubscription();
      cancelPendingInput();
      if (suppressMouseClickTimer !== undefined) window.clearTimeout(suppressMouseClickTimer);
      events.abort();
    };
  };

  const createWheelGesture = () => {
    const wheel = WheelGestures({ preventWheelAction: false });
    let swipeConsumed = false;
    const stopListening = wheel.on("wheel", (state) => {
      if (state.isStart) {
        inertia.stop();
        wheelActive = true;
        swipeConsumed = false;
        if (wheelBoundaryDirection === null) wheelBoundaryConsumed = false;
      }
      if (state.isEnding || state.isMomentumCancel) {
        wheelActive = false;
        swipeConsumed = false;
        if (wheelBoundaryDirection === null) {
          wheelBoundaryConsumed = false;
        }
        if (state.isMomentumCancel) inertia.stop();
        return;
      }

      const event = state.event as WheelEvent;
      if (!eventBelongsToReader(event) || event.ctrlKey || event.metaKey) return;
      if (!canTurnPage()) {
        consumeReaderEvent(event);
        swipeConsumed = true;
        inertia.stop();
        return;
      }
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
          // wheel-gestures reverses the native X/Y signs by default. Restore
          // the browser's effective wheel direction here, just as deltaX and
          // deltaY above do, so OS natural-scrolling preferences are honored.
          const nativeMovementX = -movementX;
          dispatchStep(nativeMovementX < 0 ? "left" : "right");
          return;
        }
      }

      if (swipeConsumed || options.getFlow() !== "scrolled" || isHorizontal) return;
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
    return {
      observe: (target: Document) => wheel.observe(target),
      destroy: () => {
        stopListening();
        wheel.disconnect();
      },
    };
  };

  const wheelGesture = createWheelGesture();

  const bindSideButtonNavigation = (targetDocument: Document) => {
    const events = new AbortController();
    let pressedButton: 3 | 4 | null = null;
    let tracking: AbortController | null = null;

    function stopSideButtonEvent(event: MouseEvent | PointerEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      consumeReaderEvent(event, "immediate");
    }
    function handlePointerMove(event: PointerEvent) {
      if (event.buttons & 24) consumeReaderEvent(event, "immediate");
      else stopTracking();
    }
    function startTracking() {
      if (tracking) return;
      tracking = new AbortController();
      targetDocument.addEventListener("pointermove", handlePointerMove, {
        capture: true,
        signal: AbortSignal.any([events.signal, tracking.signal]),
      });
    }
    function stopTracking() {
      pressedButton = null;
      tracking?.abort();
      tracking = null;
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
    const stopOverlaySubscription = overlayInput.subscribe(stopTracking);

    const signal = events.signal;
    targetDocument.addEventListener("mousedown", handleMouseDown, { capture: true, signal });
    targetDocument.addEventListener("mouseup", handleMouseUp, { capture: true, signal });
    targetDocument.addEventListener("auxclick", stopSideButtonEvent, { capture: true, signal });
    targetWindow?.addEventListener("blur", stopTracking, { signal });
    return () => {
      stopOverlaySubscription();
      stopTracking();
      events.abort();
    };
  };

  const bindInputTarget = (targetDocument: Document) => {
    if (inputTargets.has(targetDocument)) return;
    const events = new AbortController();
    for (const type of overlayInputEvents) {
      (targetDocument.defaultView ?? targetDocument).addEventListener(type, overlayInput.capture, {
        capture: true,
        passive: false,
        signal: events.signal,
      });
    }
    const touchStyle = targetDocument === document ? null : targetDocument.createElement("style");
    if (touchStyle) {
      touchStyle.textContent = "html { touch-action: pinch-zoom !important; }";
      targetDocument.head?.append(touchStyle);
    }
    targetDocument.addEventListener("keydown", handleKeyDown, { signal: events.signal });
    const stopPointer = targetDocument === document
      ? () => {}
      : bindPointerInput(targetDocument, targetDocument);
    const stopWheel = wheelGesture.observe(targetDocument);
    const stopSideButtons = bindSideButtonNavigation(targetDocument);
    inputTargets.set(targetDocument, () => {
      stopPointer();
      stopWheel();
      stopSideButtons();
      events.abort();
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
    const stopShellDrag = bindPointerInput(view, document);
    const stopDocuments = observeRenderedContent(view, ({ doc }, signal) => {
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
      stopOverlayInput();
      inertia.stop();
      wheelActive = false;
      clearWheelBoundary();
      bindings.forEach((_, view) => unbindReaderView(view));
      inputTargets.forEach((dispose) => dispose());
      inputTargets.clear();
      wheelGesture.destroy();
    },
    scrollByKey,
    executeStep,
    executePaginate,
    unbindReaderView,
  };
}
