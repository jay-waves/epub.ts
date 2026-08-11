import { platform } from "#platform";
import type { View } from "../renderer";

type ReaderThemeMode = "light" | "dark";
export type ReaderFlow = "paginated" | "scrolled";
export type PageTurnDirection = "left" | "right";
export type ReaderThemeId = "light" | "grey" | "dark" | "one-dark" | "gruvbox";

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
  primary: string;
  secondary: string;
  secondaryInk: string;
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

export type ReaderView = View<ReaderHighlight>;

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

export function createDebouncedTask<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
  delay: number,
) {
  let timer: number | undefined;
  let pendingArgs: Args | undefined;

  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
    pendingArgs = undefined;
  };

  const flush = () => {
    if (!pendingArgs) return;
    const args = pendingArgs;
    cancel();
    callback(...args);
  };

  return {
    cancel,
    flush,
    schedule: (...args: Args) => {
      window.clearTimeout(timer);
      pendingArgs = args;
      timer = window.setTimeout(() => { void flush(); }, delay);
    },
  };
}
