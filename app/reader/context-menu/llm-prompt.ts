export function buildLlmPrompt(template: string, text: string) {
  return template.includes("%s") ? template.replace("%s", text) : `${template}\n\n${text}`;
}
