export function runWhenIdle(callback: () => void, timeout = 500, fallbackDelay = 0) {
  const requestIdle = globalThis.requestIdleCallback;
  if (requestIdle) return void requestIdle(callback, { timeout });
  globalThis.setTimeout(callback, fallbackDelay);
}

export function createDebouncedTask<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
) {
  let timer: number | undefined;

  return {
    cancel: () => window.clearTimeout(timer),
    schedule: (...args: Args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    },
  };
}
