const RESIZE_SETTLE_DELAY_MS = 100;

/** Coalesces a burst of element resizes into one expensive layout pass. */
export function observeSettledResize(
  target: Element,
  callback: () => void,
  delay = RESIZE_SETTLE_DELAY_MS,
) {
  let timer: number | undefined;
  const observer = new ResizeObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      callback();
    }, delay);
  });
  observer.observe(target);

  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
    timer = undefined;
  };
}
