import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { usePointPopover } from '../../app/reader/ui/components/use-point-popover';
import { overlayInput } from '../../app/reader/overlay-input';

const host = document.createElement('div');
document.body.replaceChildren(host);
const root = createRoot(host);
window.addEventListener('keydown', overlayInput.capture, true);
type Props = { x: number; y: number; width?: number; height?: number; open?: boolean };
function Panel({ x, y, width = 200, height = 120, open = true }: Props) {
  const { setPopover, popoverStyle } = usePointPopover({ x, y, open, onDismiss: () => show({ x, y, open: false }) });
  return open ? createElement('div', {
    id: 'test-popover', 'data-point': `${x},${y},${width},${height}`, popover: 'manual', ref: setPopover,
    style: { position: 'fixed', inset: 'auto', margin: 0, padding: 0, border: 0, width, height, ...popoverStyle },
  }, 'Popover') : null;
}
export function show(props: Props) { root.render(createElement(Panel, props)); }
export function locked() { return overlayInput.locked; }
