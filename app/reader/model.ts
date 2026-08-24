import { platform } from "#platform";
import type { View } from "../renderer";
import type { ReaderAnnotation } from "../epub/annotation";
import { DEFAULT_TYPOGRAPHY_FONTS } from "../typography/model";
import type {
  TypographyFonts,
  TypographyTextAlignment,
  TypographyTheme,
  TypographyThemeId,
} from "../typography/model";

export type ReaderFlow = "paginated" | "scrolled";
export type StepDirection = "left" | "right";
export type ReaderThemeId = TypographyThemeId;

export type ReaderSettings = {
  fonts: TypographyFonts;
  fontSize: number;
  layoutMode: ReaderFlow;
  layoutLevel: number;
  theme: ReaderThemeId;
  textAlignment: TypographyTextAlignment;
};

export type ReaderTheme = TypographyTheme;

export type SavedReadingPosition = {
  cfi?: string;
  fraction?: number;
  settings?: Partial<ReaderSettings>;
};

export type ReaderView = View<ReaderAnnotation>;

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fonts: { ...DEFAULT_TYPOGRAPHY_FONTS },
  fontSize: platform.readerProfile.defaultFontSize,
  layoutMode: "paginated",
  layoutLevel: 1,
  theme: "light",
  textAlignment: "auto",
};

export const readerSettings: ReaderSettings = { ...DEFAULT_READER_SETTINGS };
