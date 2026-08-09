import { platform } from "#platform";

type ReaderThemeMode = "light" | "dark";
export type ReaderFlow = "paginated" | "scrolled";
export type ReaderThemeId = "light" | "grey" | "dark" | "one-dark";

export type ReaderSettings = {
  flow: ReaderFlow;
  fontSize: number;
  layoutLevel: number;
  theme: ReaderThemeId;
};

export type ReaderTheme = {
  id: ReaderThemeId;
  bodyTheme: string;
  mode: ReaderThemeMode;
  background: string;
  foreground: string;
  link: string;
};

export type ReadingPosition = {
  cfi?: string;
  fraction?: number;
  settings?: Partial<ReaderSettings>;
};

export type ReaderHighlight = {
  value: string;
  color: string;
  text?: string;
  note?: string;
  index?: number;
  fraction?: number;
  createdAt: number;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  flow: "paginated",
  fontSize: platform.readerProfile.defaultFontSize,
  layoutLevel: 4,
  theme: "light",
};

export const readerSettings: ReaderSettings = { ...DEFAULT_READER_SETTINGS };

export function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function runWhenIdle(callback: () => void, timeout = 500, fallbackDelay = 0) {
  const requestIdle = globalThis.requestIdleCallback;
  if (requestIdle) {
    const handle = requestIdle(callback, { timeout });
    return () => globalThis.cancelIdleCallback(handle);
  }
  const handle = globalThis.setTimeout(callback, fallbackDelay);
  return () => globalThis.clearTimeout(handle);
}

export function createDebouncedTask<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
) {
  let timer: number | undefined;

  return {
    cancel: () => {
      window.clearTimeout(timer);
      timer = undefined;
    },
    schedule: (...args: Args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    },
  };
}
