export function buildLlmPrompt(template: string, text: string) {
  template = template.replaceAll("{{targetLanguage}}", "Chinese");
  if (template.includes("{{selectedText}}")) return template.replace("{{selectedText}}", () => text);
  return template.includes("%s") ? template.replace("%s", () => text) : `${template}\n\n${text}`;
}
