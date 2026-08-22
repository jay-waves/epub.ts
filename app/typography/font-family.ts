const READER_FONT_FAMILIES = {
  serif: "var(--reader-font-serif)",
  sans: "var(--reader-font-sans)",
  mono: "var(--reader-font-mono)",
} as const;

const MONO_FAMILIES = /(?:^|[,\s"'])(?:monospace|courier(?:\s+new)?|consolas|menlo|monaco|inconsolata|source\s+code|noto\s+sans\s+mono)(?=$|[,\s"'])/iu;
const SANS_FAMILIES = /(?:^|[,\s"'])(?:sans-serif|arial|helvetica|verdana|tahoma|roboto|inter|noto\s+sans|source\s+sans|source\s+han\s+sans|pingfang|heiti|simhei|yahei)(?=$|[,\s"'])/iu;
const SERIF_FAMILIES = /(?:^|[,\s"'])(?:serif|times(?:\s+new\s+roman)?|georgia|garamond|palatino|baskerville|noto\s+serif|source\s+serif|source\s+han\s+serif|songti|simsun|mincho|mingliu)(?=$|[,\s"'])/iu;

export function getReaderFontFamily(value: string) {
  if (MONO_FAMILIES.test(value)) return READER_FONT_FAMILIES.mono;
  if (SANS_FAMILIES.test(value)) return READER_FONT_FAMILIES.sans;
  if (SERIF_FAMILIES.test(value)) return READER_FONT_FAMILIES.serif;
  return null;
}

export function rewritePublisherFontFamilies(css: string) {
  return css.replace(
    /font-family\s*:\s*([^;}{!]+)(?:\s*!important)?/giu,
    (declaration, value: string) => {
      const family = getReaderFontFamily(value);
      return family ? `font-family: ${family} !important` : declaration;
    },
  );
}
