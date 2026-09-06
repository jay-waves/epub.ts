export type TypographyThemeId = "light" | "glacier" | "grey" | "nord" | "dark" | "gruvbox";
export type TypographyTextAlignment = "auto" | "start" | "justify";

export type TypographyFonts = {
  serif: string;
  sans: string;
  mono: string;
};

export const DEFAULT_TYPOGRAPHY_FONTS: TypographyFonts = {
  serif: "EB Garamond EPUB, Noto Serif, Noto Serif SC, Noto Serif CJK SC, Source Han Serif SC, Songti SC, STSong, SimSun, Georgia, Times New Roman, serif",
  sans: "Noto Sans, Noto Sans SC, Noto Sans CJK SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif",
  mono: "Monaspace Argon EPUB, Sarasa Mono SC, Maple Mono SC NF, Cascadia Code, SFMono-Regular, Consolas, monospace",
};

export type TypographyTheme = {
  id: TypographyThemeId;
  bodyTheme: string;
  mode: "light" | "dark";
  background: string;
  foreground: string;
  link: string;
  primary: string;
  comment?: string;
  secondary: string;
  secondaryInk: string;
};
