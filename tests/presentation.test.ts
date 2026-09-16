import { describe, expect, it } from 'vitest';
import { CANVAS_COLORS, MODE_LABELS, flipLabel, proofStatus } from '../src/ui/presentation';
import { readFileSync } from 'node:fs';

// Literal expectations: user-facing transform and proof state must not lie.
describe('UI state labels', () => {
  it('names all repeat modes without changing model keys', () => {
    expect(MODE_LABELS).toEqual({ straight: 'Straight', 'half-drop': 'Half-drop', brick: 'Brick' });
  });
  it.each([
    [false, false, 'Not flipped'], [true, false, 'H flipped'],
    [false, true, 'V flipped'], [true, true, 'H + V flipped'],
  ] as const)('flip state %s / %s', (flipX, flipY, label) => {
    expect(flipLabel({ flipX, flipY })).toBe(label);
  });
  it('no export is not verified', () => expect(proofStatus(null, 'doc', false, false)).toBe('empty'));
  it('new Blob is pending, not the prior success', () => expect(proofStatus('doc', 'doc', false, false)).toBe('decoding'));
  it('only a decoded matching document is verified', () => expect(proofStatus('doc', 'doc', true, false)).toBe('verified'));
  it('editing after export makes even a decoded proof stale', () => expect(proofStatus('old', 'new', true, false)).toBe('stale'));
  it('editing while decoding also marks the export stale', () => expect(proofStatus('old', 'new', false, false)).toBe('stale'));
  it('decode failure cannot display success', () => expect(proofStatus('doc', 'doc', false, true)).toBe('failed'));
  it('a stale failed proof reports failure; the UI keeps its independent stale badge', () => expect(proofStatus('old', 'new', false, true)).toBe('failed'));
});

describe('design token guardrails', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  it('canvas selection shares the CSS accent; cell boundary remains neutral', () => {
    expect(css.includes(`--accent: ${CANVAS_COLORS.accent};`)).toBe(true);
    expect(CANVAS_COLORS.outline).toBe('#707782');
  });
  it('does not reintroduce tiny text or serif styling', () => {
    expect(/font-size:\s*(?:[0-9])px/.test(css)).toBe(false);
    expect(css.includes('Georgia')).toBe(false);
  });
  it('does not distort the decoded proof on short desktops', () => {
    expect(css.includes('aspect-ratio: 4 / 3')).toBe(true);
    expect(css.includes('.proof-container { max-height:')).toBe(false);
  });
});
