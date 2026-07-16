export type ReaderThemeMode = "light" | "dark";
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
  label: string;
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
  kind?: "annotation" | "highlight";
  text?: string;
  note?: string;
  index?: number;
  fraction?: number;
  createdAt: number;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  flow: "paginated",
  fontSize: 16,
  layoutLevel: 4,
  theme: "light",
};

export const state = {
  flow: DEFAULT_READER_SETTINGS.flow as ReaderFlow,
  currentHref: "",
  currentBookKey: "",
  currentSourceUrl: "",
  isRestoring: false,
  readerFontSize: DEFAULT_READER_SETTINGS.fontSize,
  readerLayoutLevel: DEFAULT_READER_SETTINGS.layoutLevel,
  readerTheme: DEFAULT_READER_SETTINGS.theme as ReaderThemeId,
};

export function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

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
