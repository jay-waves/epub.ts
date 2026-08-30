export function baseLanguage(language: string) {
  try {
    return new Intl.Locale(language).language;
  } catch {
    return language.toLowerCase().split("-")[0];
  }
}

export function translationModelLanguage(language: string) {
  try {
    return new Intl.Locale(language).baseName.toLowerCase();
  } catch {
    return baseLanguage(language);
  }
}
