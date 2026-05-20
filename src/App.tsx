import { ReaderDock } from "./components/reader-dock";
import { HighlightContextMenu } from "./components/context-menu";
import { PageClickZones } from "./components/page-click-zones";
import { ReadingProgress } from "./components/reading-progress";
import { SearchBar } from "./components/search-bar";
import { TocPage } from "./components/toc-page";

export function App() {
  return (
    <div className="reader-app">
      <ReaderDock />

      <main className="reader-stage">
        <div id="reader-root" className="reader-frame" />
      </main>

      <PageClickZones />

      <ReadingProgress />

      <SearchBar />
      <TocPage />
      <HighlightContextMenu />
    </div>
  );
}
