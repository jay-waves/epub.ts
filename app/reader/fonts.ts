const documentFontLoads = new WeakMap<Document, Promise<void>>();
const FONT_LOAD_TIMEOUT = 2_000;

function waitAtMost(task: Promise<unknown>, timeout: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, timeout);
    task.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function loadDocumentFonts(doc: Document, queries: string[]) {
  if (!doc.fonts) return Promise.resolve();

  let fontsReady = documentFontLoads.get(doc);
  if (!fontsReady) {
    fontsReady = waitAtMost(
      Promise.all(queries.map((query) => doc.fonts.load(query))),
      FONT_LOAD_TIMEOUT,
    )
      .then(() => undefined)
      .catch((error) => {
        console.warn("Failed to load reader document fonts.", error);
      });
    documentFontLoads.set(doc, fontsReady);
  }
  return fontsReady;
}
