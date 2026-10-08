import { useEffect, useRef } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import type { TypographyTheme, TypographyThemeId } from "../../../typography/model";
import { getReaderThemeOptions } from "../../settings";
import { Dialog } from "./ui";

const THEME_GROUPS = [
  { label: "Light", mode: "light" },
  { label: "Dark", mode: "dark" },
] as const;
const THEME_OPTIONS = getReaderThemeOptions();

function ThemeCard({
  label,
  theme,
}: {
  label: string;
  theme: TypographyTheme;
}) {
  const preview = [
    theme.background,
    `color-mix(in srgb, ${theme.background} 82%, ${theme.foreground})`,
    theme.primary,
  ];
  return (
    <RadioGroup.Item className="theme-option" value={theme.id}>
      <span className="theme-preview" aria-hidden="true">
        {preview.map((color) => <span key={color} style={{ backgroundColor: color }} />)}
      </span>
      <span className="theme-option-label">{label}</span>
    </RadioGroup.Item>
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
      <RadioGroup.Root
        aria-label="Themes"
        className="theme-dialog-form"
        value={selected ?? ""}
        onValueChange={(value) => {
          const option = THEME_OPTIONS.find(({ theme }) => theme.id === value);
          if (option) onSelect(option.theme.id);
        }}
      >
        {THEME_GROUPS.map((group) => (
          <div aria-label={`${group.label} themes`} className="theme-group" key={group.mode} role="group">
            <div className="theme-options">
              {THEME_OPTIONS
                .filter(({ theme }) => theme.mode === group.mode)
                .map(({ label, theme }) => (
                  <ThemeCard
                    key={theme.id}
                    label={label}
                    theme={theme}
                  />
                ))}
            </div>
          </div>
        ))}
      </RadioGroup.Root>
    </Dialog>
  );
}
