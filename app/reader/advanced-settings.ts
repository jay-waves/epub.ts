import { DEFAULT_TYPOGRAPHY_FONTS } from "../typography/model";
import type { TypographyFonts, TypographyTextAlignment } from "../typography/model";

export type AdvancedReaderSettings = {
  fonts: TypographyFonts;
  textAlignment: TypographyTextAlignment;
  translationSourceLanguage: string | null;
  translationTargetLanguage: string;
};

type EpubSettingsApi = {
  readonly fonts: TypographyFonts;
  readonly sourceLanguage: string | null;
  readonly textAlignment: TypographyTextAlignment;
  readonly translationTargetLanguage: string;
  reset(): Promise<void>;
  setMonoFont(fontFamily: string): Promise<void>;
  setSansFont(fontFamily: string): Promise<void>;
  setSerifFont(fontFamily: string): Promise<void>;
  setSourceLanguage(language: string | null): Promise<void>;
  setTextAlignment(alignment: TypographyTextAlignment): Promise<void>;
  setTranslationTargetLanguage(language: string): Promise<void>;
};

const STORAGE_KEY = "epub.ts:advanced-settings";

export function createAdvancedSettingsController(
  onChange: (settings: AdvancedReaderSettings) => Promise<void> | void,
) {
  let value = loadSettings();

  const commit = async (nextValue: AdvancedReaderSettings, apply = true) => {
    value = nextValue;
    persistSettings(value);
    if (apply) await onChange(value);
  };
  const setFont = async (role: keyof TypographyFonts, fontFamily: string) => {
    const nextFont = normalizeFontFamily(fontFamily, DEFAULT_TYPOGRAPHY_FONTS[role]);
    if (nextFont === value.fonts[role]) return;
    await commit({ ...value, fonts: { ...value.fonts, [role]: nextFont } });
    console.log(
      `[epub.ts] ${role} font changed to "${nextFont}". Default: "${DEFAULT_TYPOGRAPHY_FONTS[role]}".`,
    );
  };
  const api: EpubSettingsApi = {
    get fonts() {
      return { ...value.fonts };
    },
    get sourceLanguage() {
      return value.translationSourceLanguage;
    },
    get textAlignment() {
      return value.textAlignment;
    },
    get translationTargetLanguage() {
      return value.translationTargetLanguage;
    },
    setSerifFont: (fontFamily) => setFont("serif", fontFamily),
    setSansFont: (fontFamily) => setFont("sans", fontFamily),
    setMonoFont: (fontFamily) => setFont("mono", fontFamily),
    async setSourceLanguage(language) {
      const translationSourceLanguage = language == null ? null : normalizeLanguageTag(language);
      if (translationSourceLanguage === value.translationSourceLanguage) return;
      await commit({ ...value, translationSourceLanguage }, false);
      console.log(
        translationSourceLanguage
          ? `[epub.ts] Translation source language changed to "${translationSourceLanguage}".`
          : "[epub.ts] Translation source language reset to automatic detection.",
      );
    },
    async setTextAlignment(textAlignment) {
      if (!isTextAlignment(textAlignment)) {
        throw new TypeError("textAlignment must be 'auto', 'start', or 'justify'.");
      }
      if (textAlignment === value.textAlignment) return;
      await commit({ ...value, textAlignment });
      console.log(`[epub.ts] Text alignment changed to "${textAlignment}". Default: "auto".`);
    },
    async setTranslationTargetLanguage(language) {
      const translationTargetLanguage = normalizeLanguageTag(language);
      if (translationTargetLanguage === value.translationTargetLanguage) return;
      await commit({ ...value, translationTargetLanguage }, false);
      console.log(
        `[epub.ts] Translation target language changed to "${translationTargetLanguage}". Browser default: "${getBrowserLanguage()}".`,
      );
    },
    async reset() {
      if (!Object.keys(getSettingsOverrides(value)).length) return;
      value = getDefaults();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        console.warn("[epub.ts] Could not clear advanced settings.", error);
      }
      await onChange(value);
      console.log("[epub.ts] Advanced settings reset to defaults.");
    },
  };

  const consoleGlobal = globalThis as typeof globalThis & {
    epub?: Record<string, unknown> & { settings?: EpubSettingsApi };
  };
  consoleGlobal.epub = { ...consoleGlobal.epub, settings: api };

  return {
    get value() {
      return value;
    },
    logStatus() {
      const overrides = getSettingsOverrides(value);
      if (!Object.keys(overrides).length) return false;
      console.log("[epub.ts] Active advanced setting overrides.", overrides);
      return true;
    },
  };
}

function getSettingsOverrides(settings: AdvancedReaderSettings) {
  const overrides: Record<string, { current: string; default: string }> = {};
  if (settings.fonts.serif !== DEFAULT_TYPOGRAPHY_FONTS.serif) {
    overrides.serifFont = { current: settings.fonts.serif, default: DEFAULT_TYPOGRAPHY_FONTS.serif };
  }
  if (settings.fonts.sans !== DEFAULT_TYPOGRAPHY_FONTS.sans) {
    overrides.sansFont = { current: settings.fonts.sans, default: DEFAULT_TYPOGRAPHY_FONTS.sans };
  }
  if (settings.fonts.mono !== DEFAULT_TYPOGRAPHY_FONTS.mono) {
    overrides.monoFont = { current: settings.fonts.mono, default: DEFAULT_TYPOGRAPHY_FONTS.mono };
  }
  if (settings.textAlignment !== "auto") {
    overrides.textAlignment = { current: settings.textAlignment, default: "auto" };
  }
  if (settings.translationSourceLanguage) {
    overrides.translationSourceLanguage = {
      current: settings.translationSourceLanguage,
      default: "auto",
    };
  }
  if (settings.translationTargetLanguage !== getBrowserLanguage()) {
    overrides.translationTargetLanguage = {
      current: settings.translationTargetLanguage,
      default: getBrowserLanguage(),
    };
  }
  return overrides;
}

function getDefaults(): AdvancedReaderSettings {
  return {
    fonts: { ...DEFAULT_TYPOGRAPHY_FONTS },
    textAlignment: "auto",
    translationSourceLanguage: null,
    translationTargetLanguage: getBrowserLanguage(),
  };
}

function loadSettings(): AdvancedReaderSettings {
  const defaults = getDefaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as {
      fonts?: Partial<TypographyFonts>;
      textAlignment?: unknown;
      translationSourceLanguage?: unknown;
      translationTargetLanguage?: unknown;
    } | null;
    if (!saved) return defaults;
    return {
      fonts: {
        serif: normalizeFontFamily(saved.fonts?.serif, defaults.fonts.serif),
        sans: normalizeFontFamily(saved.fonts?.sans, defaults.fonts.sans),
        mono: normalizeFontFamily(saved.fonts?.mono, defaults.fonts.mono),
      },
      textAlignment: isTextAlignment(saved.textAlignment) ? saved.textAlignment : "auto",
      translationSourceLanguage: normalizeSavedLanguageTag(saved.translationSourceLanguage),
      translationTargetLanguage: normalizeLanguageTag(
        saved.translationTargetLanguage,
        defaults.translationTargetLanguage,
      ),
    };
  } catch (error) {
    console.warn("[epub.ts] Could not read advanced settings; defaults are active.", error);
    return defaults;
  }
}

function persistSettings(settings: AdvancedReaderSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("[epub.ts] Could not persist advanced settings.", error);
  }
}

function isTextAlignment(value: unknown): value is TypographyTextAlignment {
  return value === "auto" || value === "start" || value === "justify";
}

function getBrowserLanguage() {
  return normalizeLanguageTag(navigator.languages[0] ?? navigator.language, "en");
}

function normalizeLanguageTag(value: unknown, fallback?: string) {
  const language = typeof value === "string" ? value.trim().replaceAll("_", "-") : "";
  try {
    if (language) return (Intl.getCanonicalLocales(language)[0] ?? fallback ?? "en").toLowerCase();
  } catch {
    // Report invalid console input below; ignore invalid persisted values.
  }
  if (fallback) return fallback.toLowerCase();
  throw new TypeError("language must be a valid BCP 47 language tag, such as 'en' or 'zh-CN'.");
}

function normalizeSavedLanguageTag(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return normalizeLanguageTag(value);
  } catch {
    return null;
  }
}

function normalizeFontFamily(value: unknown, fallback: string) {
  const font = typeof value === "string"
    ? value.trim().replaceAll(/[\u0000-\u001f\u007f]/gu, "").slice(0, 1000)
    : "";
  const legacyNames: Record<string, string> = {
    "eb-garamond": fallback,
    "monaspace-argon": fallback,
    "noto-sans": "Noto Sans",
    "noto-serif": "Noto Serif",
    "system-mono": "ui-monospace",
    "system-sans": "system-ui",
    "system-serif": "ui-serif",
  };
  if (font && legacyNames[font]) return legacyNames[font];
  return font || fallback;
}
