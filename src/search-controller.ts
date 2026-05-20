import type { FoliateViewElement, SearchHit } from "./viewer-types";
import { VIEWER_EVENTS } from "./viewer-events";
import type { SearchUpdateDetail } from "./viewer-events";
import { getSavedHighlights } from "./viewer-storage";

const LONG_SEARCH_QUERY_THRESHOLD = 24;
const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 200;

export function createSearchController(options: {
  openSearchButton: HTMLButtonElement;
  getBookKey: () => string;
  getReaderView: () => FoliateViewElement | null;
}) {
  let searchRunId = 0;
  let searchHits: SearchHit[] = [];
  let searchHitIndex = -1;

  const updateButton = () => {
    const canSearch = Boolean(options.getReaderView()?.search);
    options.openSearchButton.disabled = !canSearch;
    options.openSearchButton.setAttribute("aria-disabled", canSearch ? "false" : "true");
  };

  const emitUpdate = (detail: SearchUpdateDetail) => {
    window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchUpdate, { detail }));
  };

  const clearHighlights = () => {
    options.getReaderView()?.clearSearch?.();
  };

  const updateNav = (visible = searchHits.length > 0) => {
    const hasHits = searchHits.length > 0;
    emitUpdate({
      canNavigate: hasHits,
      countText: hasHits ? `${searchHitIndex + 1} / ${searchHits.length}` : "0 / 0",
      placeholder: "Search text",
      visible,
    });
  };

  const showHit = async (index: number) => {
    const readerView = options.getReaderView();
    if (!readerView || !searchHits.length) return;

    searchHitIndex = (index + searchHits.length) % searchHits.length;
    updateNav();

    const hit = searchHits[searchHitIndex];
    if (!hit) return;

    try {
      await (readerView.select?.(hit.cfi) ?? readerView.goTo(hit.cfi));
    } catch (error) {
      console.warn("Failed to navigate to search hit.", error);
    }
  };

  const clear = () => {
    ++searchRunId;
    searchHits = [];
    searchHitIndex = -1;
    updateNav(false);
    clearHighlights();
  };

  const collectHighlights = async (query: string) => {
    const bookKey = options.getBookKey();
    if (!bookKey) return;

    const searchOptions = getSearchOptions(query);
    clearHighlights();
    searchHits = [];
    searchHitIndex = -1;
    updateNav(true);

    const normalizedQuery = normalizeForHighlightSearch(searchOptions.query);
    const highlights = await getSavedHighlights(bookKey);

    searchHits = highlights
      .filter((highlight) => {
        const text = getHighlightSearchText(highlight);
        return !normalizedQuery || normalizeForHighlightSearch(text).includes(normalizedQuery);
      })
      .slice(0, MAX_SEARCH_RESULTS)
      .map((highlight) => ({
        cfi: highlight.value,
        excerpt: highlight.text,
      }));

    updateNav();
    if (searchHits.length) {
      await showHit(0);
    } else {
      emitUpdate({
        canNavigate: false,
        countText: "0 / 0",
        placeholder: searchOptions.query ? `No highlights for: ${searchOptions.query}` : "No highlights saved",
        visible: true,
      });
    }
  };

  const collect = async (query: string, collectOptions: { highlightedOnly?: boolean } = {}) => {
    if (collectOptions.highlightedOnly) {
      await collectHighlights(query);
      return;
    }

    const readerView = options.getReaderView();
    if (!readerView?.search) return;

    const searchOptions = getSearchOptions(query);
    clearHighlights();
    searchHits = [];
    searchHitIndex = -1;
    updateNav(true);

    if (!searchOptions.query) return;

    const runId = ++searchRunId;

    try {
      searchBook:
      for await (const entry of readerView.search(searchOptions)) {
        if (runId !== searchRunId) return;
        if (entry === "done") break;

        if (typeof entry === "object" && entry) {
          const hits =
            "subitems" in entry && Array.isArray(entry.subitems)
              ? (entry.subitems as SearchHit[])
              : "cfi" in entry
                ? [entry as SearchHit]
                : [];

          for (const hit of hits) {
            searchHits.push({ cfi: hit.cfi, excerpt: hit.excerpt });
            if (searchHits.length >= MAX_SEARCH_RESULTS) break searchBook;
          }
        }
      }

      if (runId !== searchRunId) return;
      updateNav();
      if (searchHits.length) {
        await showHit(0);
      } else {
        emitUpdate({
          canNavigate: false,
          countText: "0 / 0",
          placeholder: `No results for: ${searchOptions.query}`,
          visible: true,
        });
      }
    } catch (error) {
      if (runId !== searchRunId) return;
      console.error("Search failed.", error);
      updateNav();
    }
  };

  const showPrevious = () => showHit(searchHitIndex - 1);
  const showNext = () => showHit(searchHitIndex + 1);

  return { clear, collect, showHit, showNext, showPrevious, updateButton };
}

function getSearchOptions(query: string) {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const queryPrefix = normalizedQuery.slice(0, MAX_SEARCH_QUERY_LENGTH).trim();
  const useFastExactSearch = queryPrefix.length >= LONG_SEARCH_QUERY_THRESHOLD;

  return {
    matchCase: false,
    matchDiacritics: useFastExactSearch,
    query: queryPrefix,
  };
}

function getHighlightSearchText(highlight: { text?: string; value: string }) {
  return highlight.text?.trim() || highlight.value;
}

function normalizeForHighlightSearch(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
