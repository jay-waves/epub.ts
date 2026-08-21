import { platform } from "#platform";
import type { View } from "../renderer";
import type { ReaderHighlight } from "../epub/annotations";

type ReaderThemeMode = "light" | "dark";
export type ReaderFlow = "paginated" | "scrolled";
export type StepDirection = "left" | "right";
export type ReaderThemeId = "light" | "grey" | "dark" | "one-dark" | "gruvbox";

export type ReaderSettings = {
  fontSize: number;
  layoutMode: ReaderFlow;
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

export type ReaderView = View<ReaderHighlight>;

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: platform.readerProfile.defaultFontSize,
  layoutMode: "paginated",
  layoutLevel: 1,
  theme: "light",
};

export const readerSettings: ReaderSettings = { ...DEFAULT_READER_SETTINGS };
