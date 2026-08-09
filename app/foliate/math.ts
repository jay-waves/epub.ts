import {
  cacheMathSvg,
  clearBookMathSvgCache,
  getCachedMathSvg,
} from "./math-svg-cache";

type MathJaxSvgModule = typeof import("./mathjax-svg");
type MathJaxSvgRenderer = ReturnType<MathJaxSvgModule["createMathJaxSvgRenderer"]>;

type RenderedFormula = {
  formula: MathMLElement;
  container: Element;
};

const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const MATH_TEXT_SPACING = "0.25em";
const enhancedMathDocuments = new WeakSet<Document>();
const normalizedMathDocuments = new WeakSet<Document>();
let mathRendererReady: Promise<MathJaxSvgRenderer> | null = null;
let mathRenderQueue = Promise.resolve();

export function clearMathSvgCache() {
  clearBookMathSvgCache();
  const rendererReady = mathRendererReady;
  if (!rendererReady) return;

  void enqueueMathRender(async () => {
    const renderer = await rendererReady;
    renderer.reset();
    clearBookMathSvgCache();
  }).catch(() => undefined);
}

export function prepareMathRenderer() {
  if (mathRendererReady) return mathRendererReady;

  const pending = import("./mathjax-svg")
    .then((mathJax) => mathJax.createMathJaxSvgRenderer());
  mathRendererReady = pending;
  void pending.catch(() => {
    if (mathRendererReady === pending) mathRendererReady = null;
  });
  return pending;
}

export async function renderMathDocument(
  doc: Document,
  isCurrent: () => boolean,
  rendererReady?: Promise<MathJaxSvgRenderer>,
) {
  normalizeMathDocument(doc);
  if (enhancedMathDocuments.has(doc)) return;

  const formulas = Array.from(doc.querySelectorAll<MathMLElement>('math[display="block"]'));
  if (!formulas.length) {
    enhancedMathDocuments.add(doc);
    return;
  }

  let renderer: MathJaxSvgRenderer;
  try {
    renderer = await (rendererReady ?? prepareMathRenderer());
  } catch (error) {
    console.warn("Failed to load MathJax; keeping native MathML.", error);
    return;
  }
  if (!isCurrent()) return;

  await enqueueMathRender(async () => {
    await renderMathFormulas(doc, formulas, renderer, isCurrent);
  });
}

function enqueueMathRender(render: () => Promise<void>) {
  const queued = mathRenderQueue.then(render);
  mathRenderQueue = queued.catch(() => undefined);
  return queued;
}

async function renderMathFormulas(
  doc: Document,
  formulas: MathMLElement[],
  renderer: MathJaxSvgRenderer,
  isCurrent: () => boolean,
) {
  const rendered: RenderedFormula[] = [];
  for (const formula of formulas) {
    if (!formula.isConnected || !isCurrent()) return;

    try {
      const style = doc.defaultView?.getComputedStyle(formula);
      const em = Number.parseFloat(style?.fontSize ?? "") || 16;
      const containerWidth = formula.parentElement?.clientWidth
        || doc.documentElement.clientWidth
        || 80 * em;
      const source = new XMLSerializer().serializeToString(formula);
      const options = {
        containerWidth,
        em,
        ex: em / 2,
        family: style?.fontFamily ?? "",
      };
      const cacheKey = JSON.stringify([renderer.cacheKey, source, options]);
      const cached = getCachedMathSvg(cacheKey);
      const container = cached
        ? parseMathContainer(doc, cached)
        : await renderer.render(source, options);
      if (!cached && container) cacheMathSvg(cacheKey, container.outerHTML);
      if (!formula.isConnected || !isCurrent()) return;
      if (!container || container.localName !== "mjx-container") continue;
      renderer.mount(doc, container);
      rendered.push({ formula, container });
    } catch (error) {
      console.warn("Failed to render a MathML expression; keeping the native formula.", error);
    }
  }

  if (!rendered.length || !isCurrent()) return;

  for (const { formula, container: sourceContainer } of rendered) {
    if (!formula.isConnected) continue;

    const container = doc.importNode(sourceContainer, true);
    decorateMathContainer(container, formula);
    formula.replaceWith(container);
  }

  enhancedMathDocuments.add(doc);
}

function parseMathContainer(doc: Document, markup: string) {
  const template = doc.createElement("template");
  template.innerHTML = markup;
  return template.content.firstElementChild;
}

function normalizeMathDocument(doc: Document) {
  if (normalizedMathDocuments.has(doc)) return;
  normalizedMathDocuments.add(doc);

  normalizeTextSubscripts(doc);
  normalizeLatinMathIdentifiers(doc);
  normalizeMathTextSpacing(doc);
}

function normalizeMathTextSpacing(doc: Document) {
  for (const text of doc.querySelectorAll('math[display="block"] mtext')) {
    const value = text.textContent ?? "";
    if (!value.trim()) continue;

    if (!/^\s/u.test(value) && needsMathTextSpace(text.previousElementSibling, "before")) {
      text.before(createMathSpace(doc));
    }
    if (!/\s$/u.test(value) && needsMathTextSpace(text.nextElementSibling, "after")) {
      text.after(createMathSpace(doc));
    }
  }
}

function needsMathTextSpace(sibling: Element | null, side: "before" | "after") {
  if (!sibling || sibling.localName === "mspace") return false;
  if (sibling.localName !== "mo") return true;

  const operator = sibling.textContent?.trim() ?? "";
  const adjacentPunctuation = side === "before"
    ? /^[([{（【《“‘]$/u
    : /^[,.;:!?，。；：！？、)\]}）】》”’]$/u;
  return !adjacentPunctuation.test(operator);
}

function createMathSpace(doc: Document) {
  const space = doc.createElementNS(MATHML_NAMESPACE, "mspace");
  space.setAttribute("width", MATH_TEXT_SPACING);
  return space;
}

function normalizeTextSubscripts(doc: Document) {
  for (const script of doc.querySelectorAll("math msub")) {
    const subscript = script.children[1];
    if (!isSingleLetterTextSubscript(subscript)) continue;

    const continuation: Element[] = [];
    let sibling = script.nextElementSibling;
    while (isSingleLetterIdentifier(sibling)) {
      continuation.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    if (!continuation.length) continue;

    const identifier = doc.createElementNS(MATHML_NAMESPACE, "mi");
    identifier.setAttribute("mathvariant", "normal");
    identifier.textContent = [subscript, ...continuation]
      .map((letter) => letter.textContent?.trim() ?? "")
      .join("");
    subscript.replaceWith(identifier);
    for (const letter of continuation) letter.remove();
  }
}

function normalizeLatinMathIdentifiers(doc: Document) {
  for (const identifier of doc.querySelectorAll("math mi")) {
    const text = identifier.textContent?.trim() ?? "";
    if (!/^[A-Za-z]+$/u.test(text)) continue;

    const variant = identifier.getAttribute("mathvariant")?.toLowerCase() ?? "";
    if (!["", "normal", "italic", "bold", "bold-italic"].includes(variant)) continue;

    identifier.setAttribute("data-reader-math-latin", "true");
    identifier.setAttribute("mathvariant", "normal");
    const italic = variant === "italic" || variant === "bold-italic" || (!variant && text.length === 1);
    identifier.setAttribute("data-reader-math-style", italic ? "italic" : "normal");
    if (variant === "bold" || variant === "bold-italic") {
      identifier.setAttribute("data-reader-math-weight", "semibold");
    }
  }

  for (const token of doc.querySelectorAll("math mtext, math mo")) {
    const text = token.textContent?.trim() ?? "";
    if (/^[A-Za-z]{2,}$/u.test(text)) token.setAttribute("data-reader-math-text", "true");
  }
}

function isSingleLetterTextSubscript(element: Element | undefined): element is Element {
  return element?.localName === "mi"
    && element.getAttribute("mathvariant") === "normal"
    && isSingleLetter(element.textContent);
}

function isSingleLetterIdentifier(element: Element | null): element is Element {
  return element?.localName === "mi" && isSingleLetter(element.textContent);
}

function isSingleLetter(value: string | null) {
  return /^\p{L}$/u.test(value?.trim() ?? "");
}

function decorateMathContainer(container: Element, formula: MathMLElement) {
  container.classList.add("reader-math");
  const altText = formula.getAttribute("alttext")?.trim();
  if (!altText) return;

  container.setAttribute("aria-label", altText);
  container.setAttribute("role", "math");
  container.querySelector("svg")?.setAttribute("aria-hidden", "true");
}
