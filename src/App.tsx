import { ReaderDock } from "./components/ReaderDock";
import { HighlightContextMenu } from "./components/HighlightContextMenu";
import { SearchBar } from "./components/SearchBar";
import { TocPage } from "./components/TocPage";

export function App() {
  return (
    <div className="reader-app">
      <ReaderDock />

      <main className="reader-stage">
        <div id="reader-root" className="reader-frame" />
      </main>

      <button
        id="page-left-zone"
        className="page-click-zone page-click-zone--left"
        type="button"
        aria-label="Previous page"
      />
      <button
        id="page-right-zone"
        className="page-click-zone page-click-zone--right"
        type="button"
        aria-label="Next page"
      />

      <div
        id="reading-progress"
        className="reader-progress"
        role="slider"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        tabIndex={0}
      >
        <div id="reading-progress-label" className="reader-progress-label" hidden />
        <div className="reader-progress-track">
          <div id="reading-progress-fill" className="reader-progress-fill" />
        </div>
      </div>

      <SearchBar />
      <TocPage />
      <HighlightContextMenu />
    </div>
  );
}
