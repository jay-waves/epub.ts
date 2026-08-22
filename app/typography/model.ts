export type TypographyThemeId = "light" | "grey" | "dark" | "one-dark" | "gruvbox";

export type TypographyTheme = {
  id: TypographyThemeId;
  bodyTheme: string;
  mode: "light" | "dark";
  background: string;
  foreground: string;
  link: string;
  primary: string;
  secondary: string;
  secondaryInk: string;
};
