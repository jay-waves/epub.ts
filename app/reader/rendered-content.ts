import type { Content } from "../renderer";
import type { ReaderView } from "./model";

export type RenderedContentBinding = (content: Content, signal: AbortSignal) => void;

type Subscriber = {
  bind: RenderedContentBinding;
  bindings: Map<Document, AbortController>;
};

class RenderedContents {
  readonly #subscribers = new Set<Subscriber>();
  readonly #contents = new Map<Document, Content>();
  readonly #events = new AbortController();

  constructor(readonly view: ReaderView) {
    view.renderer?.getContents?.().forEach((content) => {
      this.#contents.set(content.doc, content);
    });
    view.addEventListener("load", (event) => {
      const content = { doc: event.detail.doc, index: event.detail.index };
      this.#contents.set(content.doc, content);
      this.#subscribers.forEach((subscriber) => this.#bind(subscriber, content));
    }, { signal: this.#events.signal });
    view.addEventListener("unload", (event) => {
      this.#contents.delete(event.detail.doc);
      this.#subscribers.forEach((subscriber) => {
        subscriber.bindings.get(event.detail.doc)?.abort();
        subscriber.bindings.delete(event.detail.doc);
      });
    }, { signal: this.#events.signal });
  }

  subscribe(bind: RenderedContentBinding) {
    const subscriber: Subscriber = { bind, bindings: new Map() };
    this.#subscribers.add(subscriber);
    this.#contents.forEach((content) => this.#bind(subscriber, content));
    return () => {
      subscriber.bindings.forEach((events) => events.abort());
      subscriber.bindings.clear();
      this.#subscribers.delete(subscriber);
      if (!this.#subscribers.size) this.destroy();
    };
  }

  destroy() {
    this.#events.abort();
    this.#subscribers.forEach((subscriber) => {
      subscriber.bindings.forEach((events) => events.abort());
      subscriber.bindings.clear();
    });
    this.#subscribers.clear();
    this.#contents.clear();
    hubs.delete(this.view);
  }

  #bind(subscriber: Subscriber, content: Content) {
    if (subscriber.bindings.has(content.doc)) return;
    const events = new AbortController();
    subscriber.bindings.set(content.doc, events);
    subscriber.bind(content, events.signal);
  }
}

const hubs = new WeakMap<ReaderView, RenderedContents>();

export function observeRenderedContent(view: ReaderView, bind: RenderedContentBinding) {
  let hub = hubs.get(view);
  if (!hub) {
    hub = new RenderedContents(view);
    hubs.set(view, hub);
  }
  return hub.subscribe(bind);
}
