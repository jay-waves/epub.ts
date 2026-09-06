import assert from "node:assert/strict";
import test from "node:test";
import { preservePublisherFontScale } from "../app/typography/enhancers/font-scaling.ts";

function element(size: number, mono = "", parent?: ReturnType<typeof element>, math = false): any {
  const styles = new Map<string, [string, string]>();
  const node = {
    size, styles, parentElement: parent,
    fontFamily: mono === "publisher" ? "monospace" : "serif",
    style: { setProperty: (name: string, value: string, priority: string) => styles.set(name, [value, priority]) },
    closest: (selector: string) => (selector === "math, mjx-container" ? math : mono && selector.includes(mono))
      ? node : parent?.closest(selector) ?? null,
  };
  return node;
}

test("code uses reader sizing while publisher prose hierarchy is preserved", () => {
  const body = element(16);
  const heading = element(24, "", body);
  const inline = element(18, "code", body);
  const inlineSpan = element(20, "", inline);
  const pre = element(16, "pre", body);
  const code = element(22, "code", pre);
  const token = element(26, "", code);
  const link = element(24, "a[href]", heading);
  const linkSpan = element(28, "", link);
  const semanticMono = element(16, '[data-reader-role~="mono"]', body);
  const publisherMono = element(18, "publisher", body);
  const math = element(24, "", body, true);
  const subscript = element(12, "", math);
  const monoNodes = [inline, inlineSpan, pre, code, token, link, linkSpan, semanticMono, publisherMono];
  const nodes = [heading, ...monoNodes, math, subscript];
  body.querySelectorAll = () => nodes;
  const sheet = { disabled: false };
  const doc = {
    body,
    querySelectorAll: () => [sheet],
    defaultView: { getComputedStyle: (node: { size: number; fontFamily: string }) => ({
      fontSize: `${node.size}px`, fontFamily: node.fontFamily,
    }) },
  } as unknown as Document;

  preservePublisherFontScale(doc);
  for (const node of monoNodes) {
    assert.deepEqual(node.styles.get("font-size"), ["var(--reader-code-font-size)", "important"]);
    assert.deepEqual(node.styles.get("font-family"), ["var(--reader-font-mono)", "important"]);
  }
  assert.deepEqual(heading.styles.get("font-size"), ["calc(var(--reader-font-size) * 1.5)", "important"]);
  assert.equal(sheet.disabled, false);
  assert.deepEqual(math.styles.get("font-size"), ["var(--reader-math-font-size)", "important"]);
  assert.equal(subscript.styles.has("font-size"), false);
});
