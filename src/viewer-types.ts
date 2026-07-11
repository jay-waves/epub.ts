export type ReaderThemeMode = "light" | "dark";

export type ReaderFlow = "paginated" | "scrolled";

export type ReaderThemeId = "light" | "grey" | "dark" | "one-dark";

export type ReaderSettings = {
  flow: ReaderFlow;
  fontSize: number;
  layoutLevel: number;
  margin?: number;
  spacing?: number;
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
  updatedAt: number;
};

export type ReadingHistory = Record<string, ReadingPosition>;

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

export type ReaderHighlights = Record<string, ReaderHighlight[]>;
