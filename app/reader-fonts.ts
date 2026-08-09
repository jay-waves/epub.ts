const documentFontLoads = new WeakMap<Document, Promise<void>>();

export function loadReaderDocumentFonts(doc: Document, queries: string[]) {
  if (!doc.fonts) return Promise.resolve();

  let fontsReady = documentFontLoads.get(doc);
  if (!fontsReady) {
    fontsReady = Promise.all(queries.map((query) => doc.fonts.load(query)))
      .then(() => undefined)
      .catch((error) => {
        console.warn("Failed to load reader document fonts.", error);
      });
    documentFontLoads.set(doc, fontsReady);
  }
  return fontsReady;
}
