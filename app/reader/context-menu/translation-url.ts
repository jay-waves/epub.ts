export function googleTranslationUrl(text: string) {
  const url = new URL("https://translate.google.com/");
  url.search = new URLSearchParams({ sl: "auto", text, op: "translate" }).toString();
  return url.href;
}
