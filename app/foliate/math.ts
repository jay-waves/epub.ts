type MathJaxSvgModule = typeof import("./mathjax-svg");
type MathJaxSvgRenderer = ReturnType<MathJaxSvgModule["createMathJaxSvgRenderer"]>;

type RenderedFormula = {
  formula: MathMLElement;
  container: Element;
};

const ENABLE_MATHJAX_SVG = false;
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const enhancedMathDocuments = new WeakSet<Document>();
const normalizedMathDocuments = new WeakSet<Document>();
let mathJaxReady: Promise<MathJaxSvgModule> | null = null;

export async function renderMathDocument(doc: Document, isCurrent: () => boolean) {
  normalizeMathDocument(doc);
  if (!ENABLE_MATHJAX_SVG) return;
  if (enhancedMathDocuments.has(doc)) return;

  const formulas = Array.from(
    doc.querySelectorAll<MathMLElement>('math[display="block"]'),
  );
  if (!formulas.length) {
    enhancedMathDocuments.add(doc);
    return;
  }

  let renderer: MathJaxSvgRenderer;
  try {
    const mathJax = await ensureMathJax();
    renderer = mathJax.createMathJaxSvgRenderer();
  } catch (error) {
    console.warn("Failed to load MathJax; keeping native MathML.", error);
    return;
  }
  if (!isCurrent()) return;

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
      const container = await renderer.render(source, {
        containerWidth,
        em,
        ex: em / 2,
        family: style?.fontFamily ?? "",
      });
      if (!formula.isConnected || !isCurrent()) return;
      if (!container || container.localName !== "mjx-container") continue;
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

function normalizeMathDocument(doc: Document) {
  if (normalizedMathDocuments.has(doc)) return;
  normalizedMathDocuments.add(doc);

  normalizeTextSubscripts(doc);
  normalizeLatinMathIdentifiers(doc);
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

async function ensureMathJax() {
  mathJaxReady ??= import("./mathjax-svg");
  return mathJaxReady;
}
