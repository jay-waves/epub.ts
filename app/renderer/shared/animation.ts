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
) {
  return new Promise<void>((resolve) => {
    let startTime: number | undefined;
    const step = (now: number) => {
      if (document.hidden) {
        render(endValue);
        resolve();
        return;
      }
      startTime ??= now;
      const fraction = Math.min(1, (now - startTime) / duration);
      render(lerp(startValue, endValue, ease(fraction)));
      if (fraction < 1) requestAnimationFrame(step);
      else resolve();
    };
    if (document.hidden) {
      render(endValue);
      resolve();
      return;
    }
    requestAnimationFrame(step);
  });
}
