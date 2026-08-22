import type { Anchor, Book, Content, OverlayDraw } from "../renderer";
import type { ReaderView } from "./model";
import { emitViewerEvent, VIEWER_EVENTS } from "./events";
import { annotationRepository } from "./annotation-repository";
import type { Navigation } from "./navigation";

const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS = 200;
const SVG_NS = "http://www.w3.org/2000/svg";

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

type Hit = {
  anchor?: Anchor;
  cfi: string;
  index: number;
  key?: string;
};

type SearchOptions = {
  book: Book;
  bookKey: string;
  navigation: Navigation;
  run: (action: () => Promise<unknown>) => Promise<unknown>;
  signal: AbortSignal;
  view: ReaderView;
};

const drawOutline: OverlayDraw = (rects) => {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", "var(--reader-search-outline, #d97706)");
  group.setAttribute("stroke-width", "3");
  for (const { height, left, top, width } of rects) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(left));
    rect.setAttribute("y", String(top));
    rect.setAttribute("height", String(height));
    rect.setAttribute("width", String(width));
    rect.setAttribute("rx", "3");
    group.append(rect);
  }
  return group;
};

const drawCurrent: OverlayDraw = (rects) => {
  const group = drawOutline(rects);
  group.setAttribute("fill", "var(--reader-search-current-fill, rgb(37 99 235 / 24%))");
  group.setAttribute("stroke", "var(--reader-search-current, #2563eb)");
  group.setAttribute("stroke-width", "3.5");
  return group;
};

export function createSearch({ book, bookKey, navigation, run, signal, view }: SearchOptions) {
  let runId = 0;
  let hits: Hit[] = [];
  let current = -1;
  let disposed = false;

  const publish = (placeholder = "Search text", visible = true) => {
    emitViewerEvent(VIEWER_EVENTS.searchUpdate, {
      hitCount: hits.length,
      hitIndex: current,
      placeholder,
      visible,
    });
  };

  const reset = (visible: boolean) => {
    const id = ++runId;
    for (const hit of hits) if (hit.key) view.removeDecoration(hit.index, hit.key);
    hits = [];
    current = -1;
    publish("Search text", visible);
    return id;
  };

  const paint = (hit: Hit, active: boolean) => {
    if (!hit.key) return;
    view.addDecoration(hit.index, {
      draw: active ? drawCurrent : drawOutline,
      key: hit.key,
      target: hit.anchor ?? hit.cfi,
    });
  };

  const show = async (index: number) => {
    if (!hits.length || signal.aborted) return;
    const previous = hits[current];
    current = (index + hits.length) % hits.length;
    if (previous) paint(previous, false);
    publish();
    const hit = hits[current];
    if (!hit) return;
    paint(hit, true);
    try {
      const target = hit.anchor ? { anchor: hit.anchor, index: hit.index } : hit.cfi;
      const content = view.renderer.getContents?.().find(
        (item): item is Content & { doc: Document } => item.index === hit.index && Boolean(item.doc),
      );
      const range = content?.doc ? resolveHitRange(hit, content.doc, navigation) : null;
      if (range && content && isVisible(range, content.doc, view.renderer.element)) {
        selectRange(range);
      } else if (content) {
        await navigation.go(target, { select: true });
      } else {
        await run(() => navigation.go(target, { select: true }));
      }
    } catch (error) {
      if (!signal.aborted) console.warn("Failed to navigate to search hit.", error);
    }
  };

  const showClosest = () => {
    const contents = (view.renderer.getContents?.() ?? [])
      .filter((content): content is Content & { doc: Document } => Boolean(content.doc));
    if (!contents.length) return show(0);

    const visible = hits.flatMap((hit, hitIndex) => {
      const content = contents.find((item) => item.index === hit.index);
      return content ? [{ content, hit, hitIndex }] : [];
    });
    if (visible.length) {
      let closest = visible[0]?.hitIndex ?? 0;
      let distance = Infinity;
      for (const candidate of visible) {
        const nextDistance = distanceFromViewport(candidate.hit, candidate.content, navigation, view);
        if (nextDistance >= distance) continue;
        closest = candidate.hitIndex;
        distance = nextDistance;
      }
      return show(closest);
    }

    const indexes = contents.map((content) => content.index);
    let closest = 0;
    let distance = Infinity;
    for (const [index, hit] of hits.entries()) {
      const nextDistance = Math.min(...indexes.map((currentIndex) => Math.abs(hit.index - currentIndex)));
      if (nextDistance >= distance) continue;
      closest = index;
      distance = nextDistance;
    }
    return show(closest);
  };

  const collectHighlights = async (query: string) => {
    const normalized = normalizeInlineText(query).toLocaleLowerCase();
    const id = reset(true);
    try {
      const highlights = await annotationRepository.load(bookKey);
      if (id !== runId || signal.aborted) return;

      hits = highlights.flatMap((highlight, highlightIndex) => {
        const text = normalizeInlineText(highlight.text || highlight.value).toLocaleLowerCase();
        if (normalized && !text.includes(normalized)) return [];
        const resolved = navigation.resolve(highlight.value);
        return resolved ? [{
          cfi: highlight.value,
          index: resolved.index,
          key: `search:${highlightIndex}`,
        }] : [];
      }).slice(0, MAX_RESULTS);

      for (const hit of hits) paint(hit, false);

      if (hits.length) await showClosest();
      else publish(normalized ? `No highlights for: ${query}` : "No highlights saved");
    } catch (error) {
      if (id !== runId || signal.aborted) return;
      console.error("Highlight search failed.", error);
      publish("Search failed");
    }
  };

  const collectText = async (query: string) => {
    const normalized = normalizeInlineText(query).slice(0, MAX_QUERY_LENGTH);
    const id = reset(true);
    if (!normalized) return;

    try {
      const { findText } = await import("./text-search");
      const language = book.metadata?.language;
      const locale = typeof language === "string"
        ? language
        : Array.isArray(language) && typeof language[0] === "string" ? language[0] : "en";
      searchBook: for (const [index, section] of book.sections.entries()) {
        if (!section.createDocument) continue;
        const doc = await section.createDocument();
        if (id !== runId || signal.aborted) return;

        let sectionHitIndex = 0;
        for (const range of findText(doc, normalized, locale)) {
          if (id !== runId || signal.aborted) return;
          const cfi = navigation.cfi(index, range);
          const occurrence = sectionHitIndex++;
          const anchor: Anchor = (renderedDoc) => {
            let currentOccurrence = 0;
            for (const renderedRange of findText(renderedDoc, normalized, locale)) {
              if (currentOccurrence++ === occurrence) return renderedRange;
            }
            return null;
          };
          const hit = { anchor, cfi, index, key: `search:${hits.length}` };
          hits.push(hit);
          paint(hit, false);
          if (hits.length >= MAX_RESULTS) break searchBook;
        }
      }

      if (hits.length) await showClosest();
      else publish(`No results for: ${normalized}`);
    } catch (error) {
      if (id !== runId || signal.aborted) return;
      console.error("Search failed.", error);
      publish("Search failed");
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    reset(false);
  };
  signal.addEventListener("abort", dispose, { once: true });

  return {
    clear: () => reset(false),
    collect: (query: string, highlightedOnly = false) => highlightedOnly
      ? collectHighlights(query)
      : collectText(query),
    next: () => show(current + 1),
    open: () => publish(),
    previous: () => show(current - 1),
    dispose,
  };
}

function distanceFromViewport(
  hit: Hit,
  content: Content & { doc: Document },
  navigation: Navigation,
  view: ReaderView,
) {
  const anchor = resolveHitRange(hit, content.doc, navigation);
  return anchor ? distanceToViewport(anchor, content.doc, view.renderer.element) : Infinity;
}

function resolveHitRange(hit: Hit, doc: Document, navigation: Navigation) {
  const anchor = hit.anchor ?? navigation.resolve(hit.cfi)?.anchor;
  if (typeof anchor !== "function") return null;
  try {
    const range = anchor(doc);
    return range instanceof (doc.defaultView?.Range ?? Range) ? range : null;
  } catch {
    return null;
  }
}

function isVisible(range: Range, doc: Document, viewport: Element) {
  return distanceToViewport(range, doc, viewport) === 0;
}

function distanceToViewport(range: Range, doc: Document, viewport: Element) {
  const view = doc.defaultView;
  const frame = view?.frameElement as HTMLElement | null;
  if (!frame) return Infinity;

  const frameRect = frame.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const scaleX = frameRect.width / Math.max(1, frame.offsetWidth);
  const scaleY = frameRect.height / Math.max(1, frame.offsetHeight);
  return Math.min(Infinity, ...Array.from(range.getClientRects()).map((rect) => {
    const left = frameRect.left + rect.left * scaleX;
    const right = frameRect.left + rect.right * scaleX;
    const top = frameRect.top + rect.top * scaleY;
    const bottom = frameRect.top + rect.bottom * scaleY;
    const dx = right < viewportRect.left
      ? viewportRect.left - right
      : left > viewportRect.right ? left - viewportRect.right : 0;
    const dy = bottom < viewportRect.top
      ? viewportRect.top - bottom
      : top > viewportRect.bottom ? top - viewportRect.bottom : 0;
    return Math.hypot(dx, dy);
  }));
}

function selectRange(range: Range) {
  const selection = range.startContainer.ownerDocument?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
