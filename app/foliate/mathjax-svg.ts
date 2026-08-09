/// <reference types="vite/client" />

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

export function createMathJaxSvgRenderer() {
  const sourceDocument = document.implementation.createHTMLDocument("");
  const output = new SVG({
    fontCache: "local",
    fontData: MathJaxNewcmFont,
    scale: 1.55,
    useXlink: false,
  });
  const mathDocument = mathjax.document(sourceDocument, {
    InputJax: new MathML(),
    OutputJax: output,
  });

  return {
    cacheKey: "mathjax-newcm-svg-1.55",
    async render(source: string, options: MathJaxSvgRenderOptions) {
      return await mathDocument.convertPromise(source, options) as Element;
    },
  };
}
