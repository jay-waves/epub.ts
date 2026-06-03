import { ReaderDock } from "./components/reader-dock";
import { HighlightContextMenu } from "./components/context-menu";
import { ReadingProgress } from "./components/reading-progress";
import { SearchBar } from "./components/search-bar";
import { TranslationPopover } from "./components/translation-popover";
import { TocPage } from "./components/toc-page";
import type { ReadingProgressElements } from "./components/reading-progress";

export function App({
  onReadingProgressReady,
}: {
  onReadingProgressReady?: (elements: ReadingProgressElements | null) => void;
}) {
  return (
    <div className="reader-app">
      <ReaderDock />

      <main className="reader-stage">
        <div id="reader-root" className="reader-frame" />
      </main>

      <ReadingProgress onReady={onReadingProgressReady} />

      <SearchBar />
      <TocPage />
      <HighlightContextMenu />
      <TranslationPopover />
    </div>
  );
}
