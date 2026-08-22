import { platform } from "#platform";
import type { View } from "../renderer";
import type { ReaderHighlight } from "../epub/annotations";
import type { TypographyTheme, TypographyThemeId } from "../typography/model";

export type ReaderFlow = "paginated" | "scrolled";
export type StepDirection = "left" | "right";
export type ReaderThemeId = TypographyThemeId;

export type ReaderSettings = {
  fontSize: number;
  layoutMode: ReaderFlow;
  layoutLevel: number;
  theme: ReaderThemeId;
};

export type ReaderTheme = TypographyTheme;

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
