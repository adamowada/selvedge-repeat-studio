import { describe, expect, it } from 'vitest';
import { arrowDelta, releaseArrow } from '../src/ui/keyboard';

describe('workspace nudge keys', () => {
  it.each([
    ['ArrowLeft', false, { x: -1, y: 0 }], ['ArrowRight', false, { x: 1, y: 0 }],
    ['ArrowUp', false, { x: 0, y: -1 }], ['ArrowDown', false, { x: 0, y: 1 }],
    ['ArrowLeft', true, { x: -10, y: 0 }], ['ArrowRight', true, { x: 10, y: 0 }],
    ['ArrowUp', true, { x: 0, y: -10 }], ['ArrowDown', true, { x: 0, y: 10 }],
  ] as const)('%s shift=%s has a literal model-pixel delta', (key, shift, expected) => {
    expect(arrowDelta(key, shift)).toEqual(expected);
  });
  it('non-arrow keys do not become nudges', () => {
    expect(arrowDelta('Delete', true)).toBeNull();
    expect(arrowDelta('a', false)).toBeNull();
  });
  it('releasing one key of a chord does not end the gesture', () => {
    const held = new Set(['ArrowRight', 'ArrowDown']);
    expect(releaseArrow(held, 'ArrowRight')).toEqual({ handled: true, finished: false });
    expect([...held]).toEqual(['ArrowDown']);
    expect(releaseArrow(held, 'ArrowDown')).toEqual({ handled: true, finished: true });
  });
  it('an unrelated or repeated release does not handle a default or end history', () => {
    const held = new Set(['ArrowRight']);
    expect(releaseArrow(held, 'ArrowDown')).toEqual({ handled: false, finished: false });
    expect(releaseArrow(held, 'ArrowRight')).toEqual({ handled: true, finished: true });
    expect(releaseArrow(held, 'ArrowRight')).toEqual({ handled: false, finished: false });
  });
  it('key-repeat still produces only one release boundary', () => {
    const held = new Set<string>();
    for (let i = 0; i < 20; i++) held.add('ArrowRight');
    expect([...held]).toEqual(['ArrowRight']);
    expect(releaseArrow(held, 'ArrowRight')).toEqual({ handled: true, finished: true });
  });
});
