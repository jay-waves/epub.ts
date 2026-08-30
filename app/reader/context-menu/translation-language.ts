export function baseLanguage(language: string) {
  try {
    return new Intl.Locale(language).language;
  } catch {
    return language.toLowerCase().split("-")[0];
  }
}

export function translationModelLanguage(language: string) {
  try {
    const locale = new Intl.Locale(language);
    if (locale.language === "zh") {
      // TODO: Restore specific Chinese tags when Edge no longer leaves the
      // zh-Hans/zh-Hant translation model download permanently pending.
      return "lzh";
    }
    return locale.baseName.toLowerCase();
  } catch {
    return baseLanguage(language);
  }
}
