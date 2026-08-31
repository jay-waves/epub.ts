type LoadDocument<Result> = (
  document: Document,
  signal: AbortSignal,
) => Result | Promise<Result>;

/** Loads one iframe document and gives every exit path the same abort boundary. */
export async function loadFrameDocument<Result>(
  frame: HTMLIFrameElement,
  source: string,
  ownerSignal: AbortSignal,
  load: LoadDocument<Result>,
) {
  ownerSignal.throwIfAborted();
  const result = Promise.withResolvers<Result>();
  const events = new AbortController();
  const signal = AbortSignal.any([ownerSignal, events.signal]);
  const abort = () => result.reject(ownerSignal.reason);

  ownerSignal.addEventListener("abort", abort, { once: true });
  frame.addEventListener("error", () => {
    result.reject(new DOMException("Failed to load iframe document", "NetworkError"));
  }, { once: true, signal });
  frame.addEventListener("load", () => {
    const document = frame.contentDocument;
    if (!document) {
      result.reject(new DOMException("Iframe document is unavailable", "InvalidStateError"));
      return;
    }
    Promise.resolve(load(document, signal)).then(result.resolve, result.reject);
  }, { once: true, signal });

  try {
    frame.src = source;
    return await result.promise;
  } finally {
    events.abort();
    ownerSignal.removeEventListener("abort", abort);
  }
}
