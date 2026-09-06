import { useEffect, useRef, useState } from "react";
import type { SearchState } from "../model";
import { Button, Tooltip } from "./ui";
import { ChevronLeft, ChevronRight, Highlighter, X } from "lucide-react";

export function SearchBar({ onClose, onNext, onPrevious, onSearch, state }: {
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSearch: (query: string, highlightedOnly: boolean) => void;
  state: SearchState;
}) {
  const [highlightedOnly, setHighlightedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const canNavigate = state.hitCount > 0;

  useEffect(() => {
    if (state.visible) return;
    setHighlightedOnly(false);
    setQuery("");
  }, [state.visible]);
  useEffect(() => {
    if (state.visible) inputRef.current?.focus();
  }, [state.visible]);

  const submitSearch = () => onSearch(query, highlightedOnly);

  const toggleHighlightedOnly = () => {
    const nextHighlightedOnly = !highlightedOnly;
    setHighlightedOnly(nextHighlightedOnly);
    onSearch(query, nextHighlightedOnly);
  };

  return (
    <div aria-label="Search book" className="search-nav" hidden={!state.visible} role="search">
      <Tooltip label="Previous result" side="bottom">
        <Button
          aria-label="Previous result"
          disabled={!canNavigate}
          onClick={onPrevious}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </Button>
      </Tooltip>
      <span aria-live="polite" className="search-count">
        {canNavigate ? `${state.hitIndex + 1} / ${state.hitCount}` : "0 / 0"}
      </span>
      <Tooltip label="Next result" side="bottom">
        <Button
          aria-label="Next result"
          disabled={!canNavigate}
          onClick={onNext}
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
          aria-label="Search text"
          className="search-input"
          type="search"
          placeholder={state.placeholder}
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
          onClick={onClose}
        >
          <X size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
    </div>
  );
}
