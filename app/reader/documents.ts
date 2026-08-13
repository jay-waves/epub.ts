import type { Content } from "../renderer";
import type { ReaderView } from "./model";

export type DocumentBinding = (content: Content & { doc: Document }, signal: AbortSignal) => void;

type Subscriber = {
  bind: DocumentBinding;
  documents: Map<Document, AbortController>;
};

class RenderedDocuments {
  readonly #subscribers = new Set<Subscriber>();
  readonly #contents = new Map<Document, Content & { doc: Document }>();
  readonly #events = new AbortController();

  constructor(readonly view: ReaderView) {
    view.renderer?.getContents?.().forEach((content) => {
      if (content.doc) this.#contents.set(content.doc, content as Content & { doc: Document });
    });
    view.addEventListener("load", (event) => {
      const content = { doc: event.detail.doc, index: event.detail.index };
      this.#contents.set(content.doc, content);
      this.#subscribers.forEach((subscriber) => this.#bind(subscriber, content));
    }, { signal: this.#events.signal });
    view.addEventListener("unload", (event) => {
      this.#contents.delete(event.detail.doc);
      this.#subscribers.forEach((subscriber) => {
        subscriber.documents.get(event.detail.doc)?.abort();
        subscriber.documents.delete(event.detail.doc);
      });
    }, { signal: this.#events.signal });
  }

  subscribe(bind: DocumentBinding) {
    const subscriber: Subscriber = { bind, documents: new Map() };
    this.#subscribers.add(subscriber);
    this.#contents.forEach((content) => this.#bind(subscriber, content));
    return () => {
      subscriber.documents.forEach((events) => events.abort());
      subscriber.documents.clear();
      this.#subscribers.delete(subscriber);
      if (!this.#subscribers.size) this.destroy();
    };
  }

  destroy() {
    this.#events.abort();
    this.#subscribers.forEach((subscriber) => {
      subscriber.documents.forEach((events) => events.abort());
      subscriber.documents.clear();
    });
    this.#subscribers.clear();
    this.#contents.clear();
    hubs.delete(this.view);
  }

  #bind(subscriber: Subscriber, content: Content & { doc: Document }) {
    if (subscriber.documents.has(content.doc)) return;
    const events = new AbortController();
    subscriber.documents.set(content.doc, events);
    subscriber.bind(content, events.signal);
  }
}

const hubs = new WeakMap<ReaderView, RenderedDocuments>();

export function observeRenderedDocuments(view: ReaderView, bind: DocumentBinding) {
  let hub = hubs.get(view);
  if (!hub) {
    hub = new RenderedDocuments(view);
    hubs.set(view, hub);
  }
  return hub.subscribe(bind);
}
