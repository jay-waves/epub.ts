import { useEffect, useRef, useState } from "react";
import { emitViewerEvent, emitViewerSignal, VIEWER_EVENTS } from "../../events";
import type { SearchUpdateDetail } from "../../events";
import { Button, Tooltip } from "./ui";
import { useViewerEvent } from "./use-viewer-event";
import { ChevronLeft, ChevronRight, Highlighter, X } from "lucide-react";

export function SearchBar() {
  const [highlightedOnly, setHighlightedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchUpdateDetail>({ hitCount: 0, hitIndex: -1, placeholder: "Search text", visible: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const canNavigate = searchState.hitCount > 0;

  useViewerEvent(VIEWER_EVENTS.searchUpdate, (detail) => {
    setSearchState(detail);
    if (detail.visible) return;
    setHighlightedOnly(false);
    setQuery("");
  });
  useEffect(() => {
    if (searchState.visible) inputRef.current?.focus();
  }, [searchState.visible]);

  const submitSearch = () => {
    emitViewerEvent(VIEWER_EVENTS.searchCollect, { highlightedOnly, query });
  };

  const toggleHighlightedOnly = () => {
    const nextHighlightedOnly = !highlightedOnly;
    setHighlightedOnly(nextHighlightedOnly);
    emitViewerEvent(VIEWER_EVENTS.searchCollect, { highlightedOnly: nextHighlightedOnly, query });
  };

  const clearSearch = () => {
    emitViewerSignal(VIEWER_EVENTS.searchClear);
  };

  return (
    <div className="search-nav" hidden={!searchState.visible}>
      <Tooltip label="Previous result" side="bottom">
        <Button
          aria-label="Previous result"
          disabled={!canNavigate}
          onClick={() => emitViewerSignal(VIEWER_EVENTS.searchPrevious)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </Button>
      </Tooltip>
      <span className="search-count">
        {canNavigate ? `${searchState.hitIndex + 1} / ${searchState.hitCount}` : "0 / 0"}
      </span>
      <Tooltip label="Next result" side="bottom">
        <Button
          aria-label="Next result"
          disabled={!canNavigate}
          onClick={() => emitViewerSignal(VIEWER_EVENTS.searchNext)}
        >
          <ChevronRight size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <input
          className="search-input"
          type="search"
          placeholder={searchState.placeholder}
          autoComplete="off"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </form>
      <Tooltip label="Search highlights only" side="bottom">
        <Button
          aria-label="Search highlights only"
          aria-pressed={highlightedOnly}
          className={highlightedOnly ? "search-mode-active" : undefined}
          onClick={toggleHighlightedOnly}
        >
          <Highlighter size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
      <Tooltip label="Close search" side="bottom">
        <Button
          aria-label="Close search"
          onClick={clearSearch}
        >
          <X size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
    </div>
  );
}
