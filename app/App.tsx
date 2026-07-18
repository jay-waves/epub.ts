import { useState } from "react";
import { ReaderDock } from "./components/reader-dock";
import { BookInfoPage } from "./components/book-info-page";
import { HighlightContextMenu } from "./components/context-menu";
import { ReadingProgress } from "./components/reading-progress";
import { SearchBar } from "./components/search-bar";
import { TranslationPopover } from "./components/translation-popover";
import { AnnotationPopover } from "./components/annotation-popover";
import { TocPage } from "./components/toc-page";
import type { ReadingProgressElements } from "./components/reading-progress";

export function App({
  allowLocalFileOpen,
  onOpenLocalFile,
  onReadingProgressReady,
}: {
  allowLocalFileOpen: boolean;
  onOpenLocalFile: (file: File) => void;
  onReadingProgressReady: (elements: ReadingProgressElements | null) => void;
}) {
  const [showWelcome, setShowWelcome] = useState(allowLocalFileOpen);

  return (
    <>
      <div className="reader-app">
        <ReaderDock />

        <main className="reader-stage">
          <div id="reader-root" className="reader-frame" />
        </main>

        <ReadingProgress onReady={onReadingProgressReady} />

        <SearchBar />
        <BookInfoPage />
        <TocPage />
        <HighlightContextMenu />
        <AnnotationPopover />
        <TranslationPopover />
      </div>
      {showWelcome ? (
        <WebBookPicker onSelect={(file) => {
          setShowWelcome(false);
          onOpenLocalFile(file);
        }} />
      ) : null}
    </>
  );
}

function WebBookPicker({ onSelect }: { onSelect(file: File): void }) {
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState("");

  const selectFile = (file?: File) => {
    if (!file) return;
    if (file.type !== "application/epub+zip" && !file.name.toLowerCase().endsWith(".epub")) {
      setSelectionError("Please select an EPUB file.");
      return;
    }
    setSelectionError("");
    onSelect(file);
  };

  return (
    <main className="web-welcome">
      <section
        className={`web-welcome-card${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          selectFile(event.dataTransfer.files[0]);
        }}
      >
        <img className="web-welcome-logo" src="./logo.svg" alt="" />
        <h1>EPUB.ts Web Reader</h1>
        <label className="web-file-button">
          Choose an EPUB file
          <input
            type="file"
            accept="application/epub+zip,.epub"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
        </label>
        <span className="web-drop-hint">or drop an EPUB here</span>
        {selectionError ? <p className="web-selection-error" role="alert">{selectionError}</p> : null}
        <small>Local files are processed only in this browser tab and are never uploaded.</small>
      </section>
    </main>
  );
}
