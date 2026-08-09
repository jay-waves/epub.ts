/// <reference types="vite/client" />

/*
 * MathJax owns one global glyph cache for the open book. Each section gets a
 * <defs> containing only its referenced glyphs and releases it with its DOM.
 */

import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
import { browserAdaptor } from "@mathjax/src/js/adaptors/browserAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { MathML } from "@mathjax/src/js/input/mathml.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { SVG } from "@mathjax/src/js/output/svg.js";

const dynamicFontModules = import.meta.glob(
  "/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js",
);

mathjax.asyncLoad = async (name: string) => {
  const filename = name.split("/").pop();
  const load = filename
    ? dynamicFontModules[`/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/${filename}`]
    : undefined;
  if (!load) throw new Error(`Unsupported MathJax dynamic module: ${name}`);
  return load();
};

const adaptor = browserAdaptor();
RegisterHTMLHandler(adaptor);

type MathJaxSvgRenderOptions = {
  containerWidth: number;
  em: number;
  ex: number;
  family: string;
};

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const GLYPH_CACHE_ID = "reader-math-glyphs";
const STYLE_ID = "reader-math-styles";

export function createMathJaxSvgRenderer() {
  const sourceDocument = document.implementation.createHTMLDocument("");
  const output = new SVG({
    blacker: 12,
    fontCache: "global",
    fontData: MathJaxNewcmFont,
    scale: 1.35,
    useXlink: false,
  });
  const mathDocument = mathjax.document(sourceDocument, {
    InputJax: new MathML(),
    OutputJax: output,
  });

  const getDocumentResources = (doc: Document) => {
    let defs = doc.querySelector<SVGDefsElement>(`svg#${GLYPH_CACHE_ID} > defs`);
    if (!defs) {
      const svg = doc.createElementNS(SVG_NAMESPACE, "svg");
      svg.id = GLYPH_CACHE_ID;
      svg.setAttribute("aria-hidden", "true");
      svg.style.display = "none";
      defs = doc.createElementNS(SVG_NAMESPACE, "defs");
      svg.append(defs);
      doc.body.prepend(svg);
    }

    let style = doc.querySelector<HTMLStyleElement>(`style#${STYLE_ID}`);
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
      doc.head.append(style);
    }
    return { defs, style };
  };

  return {
    cacheKey: "mathjax-newcm-svg-1.35-b12-global",
    async render(source: string, options: MathJaxSvgRenderOptions) {
      return await mathDocument.convertPromise(source, options) as Element;
    },
    mount(doc: Document, container: Element) {
      const resources = getDocumentResources(doc);
      const definitions = output.fontCache.getCache() as SVGDefsElement;
      for (const use of container.querySelectorAll("use")) {
        const reference = use.getAttribute("href") ?? use.getAttribute("xlink:href");
        const id = reference?.startsWith("#") ? reference.slice(1) : null;
        if (!id || resources.defs.children.namedItem(id)) continue;

        const glyph = definitions.children.namedItem(id);
        if (!glyph) continue;
        resources.defs.append(doc.importNode(glyph, true));
      }

      const styles = (output.styleSheet(mathDocument) as HTMLStyleElement).textContent ?? "";
      if (resources.style.textContent !== styles) resources.style.textContent = styles;
    },
    reset() {
      output.clearFontCache();
    },
  };
}
