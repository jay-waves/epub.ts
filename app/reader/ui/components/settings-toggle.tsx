export function SettingsToggle({ label, checked, describedBy, onCheckedChange }: {
  label: string;
  checked: boolean;
  describedBy?: string;
  onCheckedChange(checked: boolean): void;
}) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked}
    aria-describedby={describedBy} className="settings-toggle" onClick={() => onCheckedChange(!checked)}>
    <span aria-hidden="true" />
  </button>;
}
