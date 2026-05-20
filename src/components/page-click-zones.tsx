import { VIEWER_EVENTS } from "../viewer-events";
import type { PageTurnDetail, PageTurnDirection } from "../viewer-events";

export function PageClickZones() {
  return (
    <>
      <PageClickZone
        className="page-click-zone page-click-zone--left"
        direction="left"
        label="Previous page"
      />
      <PageClickZone
        className="page-click-zone page-click-zone--right"
        direction="right"
        label="Next page"
      />
    </>
  );
}

function PageClickZone({
  className,
  direction,
  label,
}: {
  className: string;
  direction: PageTurnDirection;
  label: string;
}) {
  return (
    <button
      className={className}
      type="button"
      aria-label={label}
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent<PageTurnDetail>(VIEWER_EVENTS.pageTurn, {
            detail: { direction },
          }),
        );
      }}
    />
  );
}
