const lerp = (start: number, end: number, fraction: number) =>
  fraction * (end - start) + start;

export const easeOutQuad = (fraction: number) =>
  1 - (1 - fraction) * (1 - fraction);

export function animateNumber(
  startValue: number,
  endValue: number,
  duration: number,
  ease: (fraction: number) => number,
  render: (value: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<boolean>((resolve) => {
    let startTime: number | undefined;
    let frame: number | undefined;
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", abort);
      resolve(completed);
    };
    const abort = () => finish(false);
    const step = (now: number) => {
      if (signal?.aborted) return finish(false);
      if (document.hidden) {
        render(endValue);
        return finish(true);
      }
      startTime ??= now;
      const fraction = Math.min(1, (now - startTime) / duration);
      render(lerp(startValue, endValue, ease(fraction)));
      if (fraction < 1) frame = requestAnimationFrame(step);
      else finish(true);
    };
    if (signal?.aborted) return finish(false);
    signal?.addEventListener("abort", abort, { once: true });
    if (document.hidden) {
      render(endValue);
      return finish(true);
    }
    frame = requestAnimationFrame(step);
  });
}
