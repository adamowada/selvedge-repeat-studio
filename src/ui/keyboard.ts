import type { Point } from '../core/types';

export function isFormField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (!!target.closest('input,textarea,select') || target.isContentEditable);
}

export function arrowDelta(key: string, shift: boolean): Point | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft': return { x: -step, y: 0 };
    case 'ArrowRight': return { x: step, y: 0 };
    case 'ArrowUp': return { x: 0, y: -step };
    case 'ArrowDown': return { x: 0, y: step };
    default: return null;
  }
}

// A chord of held arrow keys is one nudge gesture, not one per released key.
export function releaseArrow(held: Set<string>, key: string) {
  const handled = held.delete(key);
  return { handled, finished: handled && held.size === 0 };
}
