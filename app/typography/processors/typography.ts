type TypographyProfile =
  | "latin"
  | "cyrillic"
  | "greek"
  | "zh-hans"
  | "zh-hant"
  | "zh-hant-hk"
  | "ja"
  | "ko"
  | "arabic"
  | "hebrew"
  | "devanagari"
  | "thai";

const TYPOGRAPHY_ATTRIBUTE = "data-reader-typography";
const TYPOGRAPHY_STYLE_ATTRIBUTE = "data-reader-typography-styles";
const SAMPLE_LENGTH = 20_000;
const MIN_HAN_CHARACTERS = 24;

// These characters are only a hint for unlabelled documents, never a converter.
const SIMPLIFIED_HINTS = new Set("这来时为国发后里东们个书长门见说车马风云广体学会开关无万与专业页边读写画声点线网龙汉语杂压旧阳阴区块从众优仅让进远选层应实变现样类组统结节张显虑历归罗苏叶钟岛刘赵陈吴郑齐爱头条历尽气产术总备华处断义".split(""));
const TRADITIONAL_HINTS = new Set("這來時為國發後裡東們個書長門見說車馬風雲廣體學會開關無萬與專業頁邊讀寫畫聲點線網龍漢語雜壓舊陽陰區塊從眾優僅讓進遠選層應實變現樣類組統結節張顯慮歷歸羅蘇葉鐘島劉趙陳吳鄭齊愛頭條盡氣產術總備華處斷義".split(""));

const TYPOGRAPHY_CSS = `
  :is(
    [${TYPOGRAPHY_ATTRIBUTE}="latin"],
    [${TYPOGRAPHY_ATTRIBUTE}="cyrillic"],
    [${TYPOGRAPHY_ATTRIBUTE}="greek"]
  ) {
    font-kerning: normal;
    font-optical-sizing: auto;
    font-variant-ligatures: common-ligatures contextual;
  }
  :is([${TYPOGRAPHY_ATTRIBUTE}^="zh"], [${TYPOGRAPHY_ATTRIBUTE}="ja"]) {
    font-kerning: normal;
  }
  :is([${TYPOGRAPHY_ATTRIBUTE}^="zh"], [${TYPOGRAPHY_ATTRIBUTE}="ja"])
    :is(p, li, blockquote, dd, dt, td, th, [data-reader-role~="paragraph"]),
  :is(p, li, blockquote, dd, dt, td, th, [data-reader-role~="paragraph"]):is(
    [${TYPOGRAPHY_ATTRIBUTE}^="zh"],
    [${TYPOGRAPHY_ATTRIBUTE}="ja"]
  ) {
    hanging-punctuation: allow-end last;
  }
  [${TYPOGRAPHY_ATTRIBUTE}^="zh"] :is(
    h1, h2, h3, h4, h5, h6, [data-reader-role~="heading"]
  ),
  [${TYPOGRAPHY_ATTRIBUTE}^="zh"] :is(
    h1, h2, h3, h4, h5, h6, [data-reader-role~="heading"]
  ) :where(*),
  :is(h1, h2, h3, h4, h5, h6, [data-reader-role~="heading"])[${TYPOGRAPHY_ATTRIBUTE}^="zh"] {
    letter-spacing: 0.025em !important;
  }
  :is([${TYPOGRAPHY_ATTRIBUTE}^="zh"], [${TYPOGRAPHY_ATTRIBUTE}="ja"]) ruby,
  ruby:is([${TYPOGRAPHY_ATTRIBUTE}^="zh"], [${TYPOGRAPHY_ATTRIBUTE}="ja"]) {
    ruby-align: space-around;
    ruby-position: over;
  }
  :is([${TYPOGRAPHY_ATTRIBUTE}^="zh"], [${TYPOGRAPHY_ATTRIBUTE}="ja"]) rt,
  rt:is([${TYPOGRAPHY_ATTRIBUTE}^="zh"], [${TYPOGRAPHY_ATTRIBUTE}="ja"]) {
    font-family: var(--reader-font-sans) !important;
    font-size: 0.5em !important;
    font-style: normal !important;
    font-weight: 400 !important;
    letter-spacing: 0.02em !important;
    line-height: 1 !important;
  }
  :is(
    [${TYPOGRAPHY_ATTRIBUTE}="arabic"],
    [${TYPOGRAPHY_ATTRIBUTE}="hebrew"],
    [${TYPOGRAPHY_ATTRIBUTE}="devanagari"],
    [${TYPOGRAPHY_ATTRIBUTE}="thai"]
  ) {
    font-kerning: normal;
    font-variant-ligatures: common-ligatures contextual;
  }
  :is(
    [${TYPOGRAPHY_ATTRIBUTE}="arabic"],
    [${TYPOGRAPHY_ATTRIBUTE}="hebrew"],
    [${TYPOGRAPHY_ATTRIBUTE}="devanagari"],
    [${TYPOGRAPHY_ATTRIBUTE}="thai"]
  ) :is(p, li, blockquote, dd, dt, td, th, [data-reader-role~="paragraph"]) {
    letter-spacing: normal !important;
  }
`;

export function enhanceTypography(doc: Document) {
  const explicitProfileElements = Array.from(
    doc.querySelectorAll<HTMLElement>("[lang], [xml\\:lang]"),
  ).flatMap((element) => {
    const profile = profileFromLanguage(getElementLanguage(element));
    if (!profile) return [];
    applyTypographyProfile(element, profile);
    return [element];
  });

  const root = doc.documentElement;
  const declaredProfile = profileFromLanguage(getElementLanguage(root))
    ?? profileFromLanguage(doc.body ? getElementLanguage(doc.body) : null);
  const inferredProfile = declaredProfile ?? inferChineseProfile(doc.body?.textContent ?? "");

  if (inferredProfile) applyTypographyProfile(root, inferredProfile);
  if (!inferredProfile && explicitProfileElements.length === 0) return;

  if (!doc.head.querySelector(`style[${TYPOGRAPHY_STYLE_ATTRIBUTE}]`)) {
    const style = doc.createElement("style");
    style.setAttribute(TYPOGRAPHY_STYLE_ATTRIBUTE, "");
    style.textContent = TYPOGRAPHY_CSS;
    doc.head.append(style);
  }
}

function applyTypographyProfile(element: HTMLElement, profile: TypographyProfile) {
  element.setAttribute(TYPOGRAPHY_ATTRIBUTE, profile);
  const justify = profile.startsWith("zh") || profile === "ja";
  const cjk = justify || profile === "ko";
  const alphabetic = profile === "latin" || profile === "cyrillic" || profile === "greek";
  element.style.setProperty("--reader-text-align", justify ? "justify" : "start");
  element.style.setProperty("--reader-text-justify", justify ? "inter-character" : "auto");
  element.style.setProperty("--reader-hyphens", alphabetic ? "auto" : "none");
  element.style.setProperty("--reader-line-break", cjk ? "strict" : "auto");
  element.style.setProperty("--reader-word-break", profile === "ko" ? "keep-all" : "normal");
  element.style.setProperty("--reader-text-autospace", justify ? "normal" : "no-autospace");
  const fonts = READER_SCRIPT_FONT_STACKS[profile as keyof typeof READER_SCRIPT_FONT_STACKS];
  if (!fonts) return;
  element.style.setProperty("--reader-font-serif", `var(--reader-config-font-serif), ${fonts.serif}`);
  element.style.setProperty("--reader-font-sans", `var(--reader-config-font-sans), ${fonts.sans}`);
}

function getElementLanguage(element: Element | null): string | null {
  return element?.getAttribute("lang")
    ?? element?.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang")
    ?? element?.getAttribute("xml:lang")
    ?? null;
}

function profileFromLanguage(language: string | null): TypographyProfile | null {
  if (!language) return null;
  try {
    const locale = new Intl.Locale(language.trim().replaceAll("_", "-")).maximize();
    if (locale.language === "zh") {
      if (locale.region === "HK" || locale.region === "MO") return "zh-hant-hk";
      return locale.script === "Hant" ? "zh-hant" : "zh-hans";
    }
    if (locale.language === "ja") return "ja";
    if (locale.language === "ko") return "ko";
    switch (locale.script) {
      case "Latn": return "latin";
      case "Cyrl": return "cyrillic";
      case "Grek": return "greek";
      case "Arab": return "arabic";
      case "Hebr": return "hebrew";
      case "Deva": return "devanagari";
      case "Thai": return "thai";
      default: return null;
    }
  } catch {
    return null;
  }
}

function inferChineseProfile(content: string): TypographyProfile | null {
  const sample = content.slice(0, SAMPLE_LENGTH);
  const hanCharacters = sample.match(/\p{Script=Han}/gu) ?? [];
  if (hanCharacters.length < MIN_HAN_CHARACTERS) return null;

  const kanaCount = (sample.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  if (kanaCount > Math.max(8, hanCharacters.length * 0.04)) return null;

  let simplifiedScore = 0;
  let traditionalScore = 0;
  for (const character of hanCharacters) {
    if (SIMPLIFIED_HINTS.has(character)) simplifiedScore += 1;
    if (TRADITIONAL_HINTS.has(character)) traditionalScore += 1;
  }

  return traditionalScore > simplifiedScore * 1.15 ? "zh-hant" : "zh-hans";
}
import { READER_SCRIPT_FONT_STACKS } from "../styles/book-styles";
