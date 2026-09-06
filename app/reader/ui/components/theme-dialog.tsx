import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import type { TypographyTheme, TypographyThemeId } from "../../../typography/model";
import { getReaderThemeOptions } from "../../settings";
import { Dialog } from "./ui";

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
  theme: TypographyTheme;
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
      tabIndex={active ? 0 : -1}
      type="button"
    >
      <span className="theme-preview" aria-hidden="true">
        {preview.map((color) => <span key={color} style={{ backgroundColor: color }} />)}
      </span>
      <span className="theme-option-label">{label}</span>
    </button>
  );
}

export function ThemeDialog({ onClose, onSelect, selected }: {
  onClose: () => void;
  onSelect: (theme: TypographyThemeId) => void;
  selected: TypographyThemeId | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (selected && dialog && !dialog.open) dialog.showModal();
    else if (!selected && dialog?.open) dialog.close();
  }, [selected]);

  const handleThemeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"].includes(event.key)) return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const current = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="radio"]');
    const currentIndex = current ? options.indexOf(current) : -1;
    if (currentIndex < 0 || !options.length) return;

    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (currentIndex + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + options.length)
          % options.length;
    options[nextIndex]?.focus();
    options[nextIndex]?.click();
  };

  return (
    <Dialog
      id="theme-modal"
      aria-labelledby="theme-dialog-title"
      className="theme-modal-box"
      onClose={onClose}
      ref={dialogRef}
    >
      <header className="theme-dialog-header">
        <h2 id="theme-dialog-title">Themes</h2>
      </header>
      <div
        aria-label="Themes"
        className="theme-dialog-form"
        onKeyDown={handleThemeKeyDown}
        role="radiogroup"
      >
        {THEME_GROUPS.map((group) => (
          <div aria-label={`${group.label} themes`} className="theme-group" key={group.mode} role="group">
            <div className="theme-options">
              {THEME_OPTIONS
                .filter(({ theme }) => theme.mode === group.mode)
                .map(({ label, theme }) => (
                  <ThemeCard
                    active={selected === theme.id}
                    key={theme.id}
                    label={label}
                    theme={theme}
                    onSelect={() => onSelect(theme.id)}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
