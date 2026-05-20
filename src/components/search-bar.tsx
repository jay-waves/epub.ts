import { useEffect, useRef, useState } from "react";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { SearchUpdateDetail } from "../viewer-events";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip } from "./ui/tooltip";
import { ChevronLeft, ChevronRight, X, Highlighter } from "lucide-react"

export function SearchBar() {
  const [highlightedOnly, setHighlightedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchUpdateDetail>({ canNavigate: false, countText: "0 / 0", placeholder: "Search text", visible: false });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOpen = () => {
      setSearchState((current) => ({ ...current, placeholder: "Search text", visible: true }));
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    const stopOpen = listenViewerEvent(VIEWER_EVENTS.searchOpen, handleOpen);
    const stopUpdate = listenViewerEvent(VIEWER_EVENTS.searchUpdate, setSearchState);
    return () => {
      stopOpen();
      stopUpdate();
    };
  }, []);

  const submitSearch = () => {
    emitViewerEvent(VIEWER_EVENTS.searchCollect, { highlightedOnly, query });
  };

  const toggleHighlightedOnly = () => {
    const nextHighlightedOnly = !highlightedOnly;
    setHighlightedOnly(nextHighlightedOnly);
    if (!nextHighlightedOnly) return;

    emitViewerEvent(VIEWER_EVENTS.searchCollect, { highlightedOnly: true, query });
  };

  const clearSearch = () => {
    setHighlightedOnly(false);
    setQuery("");
    emitViewerEvent(VIEWER_EVENTS.searchClear);
  };

  return (
    <div className="search-nav" hidden={!searchState.visible}>
      <Tooltip label="Previous result" side="bottom">
        <Button
          aria-label="Previous result"
          disabled={!searchState.canNavigate}
          variant="ghost"
          size="icon"
          onClick={() => emitViewerEvent(VIEWER_EVENTS.searchPrevious)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </Button>
      </Tooltip>
      <span className="search-count">
        {searchState.countText}
      </span>
      <Tooltip label="Next result" side="bottom">
        <Button
          aria-label="Next result"
          disabled={!searchState.canNavigate}
          variant="ghost"
          size="icon"
          onClick={() => emitViewerEvent(VIEWER_EVENTS.searchNext)}
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
        <Input
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
          variant="ghost"
          size="icon"
          onClick={toggleHighlightedOnly}
        >
          <Highlighter size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
      <Tooltip label="Close search" side="bottom">
        <Button
          aria-label="Close search"
          variant="ghost"
          size="icon"
          onClick={clearSearch}
        >
          <X size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
    </div>
  );
}
