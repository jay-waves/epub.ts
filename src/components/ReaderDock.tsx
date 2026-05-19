import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

const dockItems = [
  {
    id: "toggle-flow-button",
    label: "Switch to scrolling mode",
    icon: "book-open",
    iconId: "flow-icon",
  },
  {
    id: "toggle-theme-button",
    label: "Change theme",
    icon: "palette",
    iconClassName: "theme-icon",
    countId: "theme-count",
  },
  { id: "decrease-font-button", label: "Decrease font size", icon: "minus" },
  { id: "increase-font-button", label: "Increase font size", icon: "plus" },
  { id: "decrease-width-button", label: "Narrower layout", icon: "minimize-2" },
  { id: "increase-width-button", label: "Wider layout", icon: "maximize-2" },
  { id: "open-search-button", label: "Search", icon: "search" },
  { id: "open-toc-button", label: "Table of contents", icon: "list-tree" },
  { id: "export-button", label: "Export original EPUB", icon: "download" },
] as const;

export function ReaderDock() {
  return (
    <aside className="reader-dock-shell">
      <div className="reader-dock">
        {dockItems.map((item) => (
          <Tooltip key={item.id} label={item.label} side="right">
            <Button
              id={item.id}
              aria-label={item.label}
              variant="ghost"
              size="icon"
            >
              <span className="dock-button-content">
                <i
                  className={"iconClassName" in item ? item.iconClassName : undefined}
                  data-lucide={item.icon}
                  id={"iconId" in item ? item.iconId : undefined}
                />
                {"countId" in item ? (
                  <span id={item.countId} className="dock-button-count">
                    1
                  </span>
                ) : null}
              </span>
            </Button>
          </Tooltip>
        ))}
      </div>
    </aside>
  );
}
