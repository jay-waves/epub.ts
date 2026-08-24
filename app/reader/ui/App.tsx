import { useEffect, useState } from "react";
import { ReaderDock } from "./components/reader-dock";
import { BookInfoPage } from "./components/book-info-page";
import { ContentContextMenu } from "./components/context-menu";
import { ReadingProgress } from "./components/reading-progress";
import { SearchBar } from "./components/search-bar";
import { TranslationPopover } from "./components/translation-popover";
import { AnnotationPopover } from "./components/annotation-popover";
import { TocPage } from "./components/toc-page";
import { ThemeDialog } from "./components/theme-dialog";
import { listenViewerEvent, VIEWER_EVENTS } from "../events";

export function App({
  onOpenLocalFile,
  onPickLocalFile,
}: {
  onOpenLocalFile?: (file: File) => void;
  onPickLocalFile?: () => Promise<void>;
}) {
  const [showWelcome, setShowWelcome] = useState(Boolean(onOpenLocalFile));

  useEffect(
    () => listenViewerEvent(VIEWER_EVENTS.documentOpen, () => setShowWelcome(false)),
    [],
  );

  return (
    <>
      <div className="reader-app">
        <ReaderDock />

        <main className="reader-stage">
          <div id="reader-root" className="reader-frame" />
        </main>

        <ReadingProgress />

        <SearchBar />
        <BookInfoPage />
        <TocPage />
        <ThemeDialog />
        <ContentContextMenu />
        <AnnotationPopover />
        <TranslationPopover />
      </div>
      {showWelcome ? (
        <WebBookPicker
          onSelect={(file) => {
            setShowWelcome(false);
            onOpenLocalFile?.(file);
          }}
          onPick={onPickLocalFile ? async () => {
            await onPickLocalFile();
            setShowWelcome(false);
          } : undefined}
        />
      ) : null}
    </>
  );
}

function WebBookPicker({
  onSelect,
  onPick,
}: {
  onSelect(file: File): void;
  onPick?: () => Promise<void>;
}) {
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
        <img className="web-welcome-logo" src="./icon.png" alt="" />
        <h1>EPUB.ts Web Reader</h1>
        {onPick ? (
          <button className="web-file-button" type="button" onClick={() => {
            void onPick().catch((error: unknown) => {
              if (!(error instanceof DOMException && error.name === "AbortError")) {
                setSelectionError(error instanceof Error ? error.message : "Unable to open EPUB.");
              }
            });
          }}>
            Choose an EPUB file
          </button>
        ) : (
          <label className="web-file-button">
            Choose an EPUB file
            <input
              type="file"
              accept="application/epub+zip,.epub"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
          </label>
        )}
        <span className="web-drop-hint">or drop an EPUB here</span>
        {selectionError ? <p className="web-selection-error" role="alert">{selectionError}</p> : null}
        <small>Local files are processed only in this browser tab and are never uploaded.</small>
      </section>
    </main>
  );
}
