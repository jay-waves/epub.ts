const DRAG_THRESHOLD = 8;
const PAGE_THRESHOLD = 40;
const AXIS_DOMINANCE = 1.2;
const GRAB_DELAY_MS = 150;

type Gesture = {
  pointerId: number;
  target: Element;
  x: number;
  y: number;
  dx: number;
  dy: number;
  dragged: boolean;
  menu: MouseEvent | null;
  cursorTarget: Element;
  cursorTimer: ReturnType<typeof setTimeout> | null;
};

/** Capture before reader selection handlers; navigation still goes through the app command. */
export function installMousePageGesture(
  canStart: (target: EventTarget | null) => boolean,
  navigate: (delta: -1 | 1, axis: 'horizontal' | 'vertical') => void,
  options: { targetWindow?: Window; cursorTarget?: Element; onStart?: () => void } = {},
) {
  const targetWindow = options.targetWindow ?? window;
  let gesture: Gesture | null = null;
  let suppressMenuUntil = 0;
  let replayedMenu: Event | null = null;

  const update = (event: MouseEvent, active: Gesture) => {
    active.dx = event.clientX - active.x;
    active.dy = event.clientY - active.y;
    active.dragged ||= Math.hypot(active.dx, active.dy) >= DRAG_THRESHOLD;
  };

  const showGrabCursor = (active: Gesture) => {
    if (active.cursorTimer !== null) clearTimeout(active.cursorTimer);
    active.cursorTimer = null;
    active.cursorTarget.setAttribute('data-reader-page-grabbing', 'true');
  };

  const release = (active: Gesture) => {
    if (active.cursorTimer !== null) clearTimeout(active.cursorTimer);
    active.cursorTimer = null;
    active.cursorTarget.removeAttribute('data-reader-page-grabbing');
    if (active.target.hasPointerCapture?.(active.pointerId)) {
      active.target.releasePointerCapture(active.pointerId);
    }
  };

  const cancel = () => {
    if (!gesture) return false;
    const active = gesture;
    gesture = null;
    release(active);
    suppressMenuUntil = performance.now() + 750;
    return true;
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 2) {
      cancel();
      return;
    }
    cancel();
    suppressMenuUntil = 0;
    if (event.defaultPrevented || event.pointerType !== 'mouse' || event.buttons !== 2
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || (event.target as Node | null)?.nodeType !== 1 || !canStart(event.target)) return;
    const target = event.target as Element;
    options.onStart?.();
    gesture = {
      pointerId: event.pointerId, target,
      x: event.clientX, y: event.clientY, dx: 0, dy: 0, dragged: false, menu: null,
      cursorTarget: options.cursorTarget ?? target,
      cursorTimer: null,
    };
    const active = gesture;
    active.cursorTimer = setTimeout(() => {
      if (gesture !== active) return;
      if (!canStart(active.target)) { cancel(); return; }
      showGrabCursor(active);
    }, GRAB_DELAY_MS);
    // Track release even when the drag leaves the page or viewport.
    try { target.setPointerCapture?.(event.pointerId); }
    catch { /* A detached target cannot capture; window listeners remain the fallback. */ }
    event.preventDefault();
    // Keep a right drag from clearing selected text or beginning an annotation.
    event.stopImmediatePropagation();
  };

  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (event.buttons !== 2) {
      cancel();
      return;
    }
    update(event, gesture);
    if (gesture.dragged) {
      showGrabCursor(gesture);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const finish = (event: MouseEvent) => {
    if (!gesture || event.button !== 2) return;
    const active = gesture;
    update(event, active);
    gesture = null;
    release(active);
    event.stopImmediatePropagation();
    if (active.dragged || active.menu) suppressMenuUntil = performance.now() + 750;
    if (active.dragged) {
      event.preventDefault();
      const x = Math.abs(active.dx);
      const y = Math.abs(active.dy);
      const distance = x >= y * AXIS_DOMINANCE ? active.dx
        : y >= x * AXIS_DOMINANCE ? active.dy : 0;
      if (Math.abs(distance) >= PAGE_THRESHOLD && canStart(active.target)) {
        navigate(distance < 0 ? 1 : -1, x >= y * AXIS_DOMINANCE ? 'horizontal' : 'vertical');
      }
    } else if (active.menu && active.target.isConnected) {
      // Some platforms emit contextmenu on press. Defer it until we know this is a click.
      const menu = active.menu;
      const replay = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, composed: true, button: 2,
        clientX: menu.clientX, clientY: menu.clientY,
        screenX: menu.screenX, screenY: menu.screenY,
      });
      replayedMenu = replay;
      try { active.target.dispatchEvent(replay); }
      finally { replayedMenu = null; }
    }
  };

  const onUp = (event: PointerEvent) => {
    if (event.pointerId === gesture?.pointerId) finish(event);
  };
  // Pointer events only report the last button release for a multi-button mouse.
  const onMouseUp = (event: MouseEvent) => { finish(event); };
  const onMouseDown = (event: MouseEvent) => {
    if (!gesture) return;
    if (event.buttons !== 2) cancel();
    else if (event.button === 2) event.stopImmediatePropagation();
  };

  const onMenu = (event: MouseEvent) => {
    if (event === replayedMenu || event.button !== 2) return;
    if (gesture) gesture.menu = event;
    else if (performance.now() >= suppressMenuUntil || !canStart(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onCancel = (event: PointerEvent) => {
    if (event.pointerId === gesture?.pointerId) cancel();
  };
  const onBlur = () => { cancel(); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && cancel()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const eventOptions = { capture: true, passive: false };
  const optionsForKeys = { capture: true };
  targetWindow.addEventListener('pointerdown', onDown, eventOptions);
  targetWindow.addEventListener('pointermove', onMove, eventOptions);
  targetWindow.addEventListener('pointerup', onUp, eventOptions);
  targetWindow.addEventListener('pointercancel', onCancel, eventOptions);
  targetWindow.addEventListener('lostpointercapture', onCancel, eventOptions);
  targetWindow.addEventListener('mousedown', onMouseDown, eventOptions);
  targetWindow.addEventListener('mouseup', onMouseUp, eventOptions);
  targetWindow.addEventListener('contextmenu', onMenu, eventOptions);
  targetWindow.addEventListener('blur', onBlur);
  targetWindow.addEventListener('keydown', onKeyDown, optionsForKeys);

  return {
    cancel,
    dispose() {
      cancel();
      targetWindow.removeEventListener('pointerdown', onDown, eventOptions);
      targetWindow.removeEventListener('pointermove', onMove, eventOptions);
      targetWindow.removeEventListener('pointerup', onUp, eventOptions);
      targetWindow.removeEventListener('pointercancel', onCancel, eventOptions);
      targetWindow.removeEventListener('lostpointercapture', onCancel, eventOptions);
      targetWindow.removeEventListener('mousedown', onMouseDown, eventOptions);
      targetWindow.removeEventListener('mouseup', onMouseUp, eventOptions);
      targetWindow.removeEventListener('contextmenu', onMenu, eventOptions);
      targetWindow.removeEventListener('blur', onBlur);
      targetWindow.removeEventListener('keydown', onKeyDown, optionsForKeys);
    },
  };
}
