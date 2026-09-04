import { platform } from "#platform";
import { DEFAULT_TYPOGRAPHY_FONTS } from "../typography/model";
import type {
  TypographyFonts,
  TypographyTextAlignment,
  TypographyThemeId,
} from "../typography/model";

export type ReaderFlow = "paginated" | "scrolled";
export type ReadingDirection = -1 | 1;
export type StepDirection = "left" | "right";

export type ReaderSettings = {
  fonts: TypographyFonts;
  fontSize: number;
  layoutMode: ReaderFlow;
  layoutLevel: number;
  theme: TypographyThemeId;
  textAlignment: TypographyTextAlignment;
};

export type SavedReadingPosition = {
  cfi?: string;
  fraction?: number;
  settings?: Partial<ReaderSettings>;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fonts: { ...DEFAULT_TYPOGRAPHY_FONTS },
  fontSize: platform.readerProfile.defaultFontSize,
  layoutMode: "paginated",
  layoutLevel: 1,
  theme: "light",
  textAlignment: "auto",
};

export const readerSettings: ReaderSettings = { ...DEFAULT_READER_SETTINGS };
