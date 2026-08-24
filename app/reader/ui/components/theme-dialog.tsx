import { useRef, useState } from "react";
import { emitViewerEvent, VIEWER_EVENTS } from "../../events";
import type { ReaderTheme, ReaderThemeId } from "../../model";
import { getReaderThemeOptions } from "../../settings";
import { Dialog } from "./ui";
import { useViewerEvent } from "./use-viewer-event";

const THEME_GROUPS = [
  { label: "Light", mode: "light" },
  { label: "Dark", mode: "dark" },
] as const;
const THEME_OPTIONS = getReaderThemeOptions();

function ThemeCard({
  active,
  label,
  onSelect,
  theme,
}: {
  active: boolean;
  label: string;
  onSelect(): void;
  theme: ReaderTheme;
}) {
  const preview = [
    theme.background,
    `color-mix(in srgb, ${theme.background} 82%, ${theme.foreground})`,
    theme.primary,
  ];
  return (
    <button
      aria-checked={active}
      className="theme-option"
      data-state={active ? "checked" : "unchecked"}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span className="theme-preview" aria-hidden="true">
        {preview.map((color) => <span key={color} style={{ backgroundColor: color }} />)}
      </span>
      <span className="theme-option-label">{label}</span>
    </button>
  );
}

export function ThemeDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<ReaderThemeId>("light");

  useViewerEvent(VIEWER_EVENTS.themeOpen, (theme) => {
    setSelected(theme);
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  });

  return (
    <Dialog
      id="theme-modal"
      aria-labelledby="theme-dialog-title"
      className="theme-modal-box"
      ref={dialogRef}
    >
      <header className="theme-dialog-header">
        <h2 id="theme-dialog-title">Themes</h2>
      </header>
      <div className="theme-dialog-form">
        {THEME_GROUPS.map((group) => (
          <div className="theme-group" key={group.mode}>
            <div className="theme-options" role="radiogroup" aria-label={`${group.label} themes`}>
              {THEME_OPTIONS
                .filter(({ theme }) => theme.mode === group.mode)
                .map(({ label, theme }) => (
                  <ThemeCard
                    active={selected === theme.id}
                    key={theme.id}
                    label={label}
                    theme={theme}
                    onSelect={() => {
                      setSelected(theme.id);
                      emitViewerEvent(VIEWER_EVENTS.themeSelect, theme.id);
                    }}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
