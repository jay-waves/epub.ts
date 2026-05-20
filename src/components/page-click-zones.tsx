import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";

const pageClickZones = [
  { className: "page-click-zone page-click-zone--left", direction: "left", label: "Previous page" },
  { className: "page-click-zone page-click-zone--right", direction: "right", label: "Next page" },
] as const;

export function PageClickZones() {
  return (
    <>
      {pageClickZones.map(({ className, direction, label }) => (
        <button
          aria-label={label}
          className={className}
          key={direction}
          type="button"
          onClick={() => emitViewerEvent(VIEWER_EVENTS.pageTurn, direction)}
        />
      ))}
    </>
  );
}
