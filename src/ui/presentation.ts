import type { Mode, Placement } from '../core/types';

export const MODE_LABELS: Record<Mode, string> = {
  straight: 'Straight', 'half-drop': 'Half-drop', brick: 'Brick',
};

export function flipLabel(p: Pick<Placement, 'flipX' | 'flipY'>): string {
  if (p.flipX && p.flipY) return 'H + V flipped';
  if (p.flipX) return 'H flipped';
  if (p.flipY) return 'V flipped';
  return 'Not flipped';
}

// Match the plain-CSS tokens. Canvas nodes cannot inherit CSS custom properties.
export const CANVAS_COLORS = { outline: '#707782', accent: '#2855b8', handle: '#ffffff' };

export type ProofStatus = 'empty' | 'decoding' | 'verified' | 'stale' | 'failed';
export function proofStatus(resultFingerprint: string | null, currentFingerprint: string, decoded: boolean, failed: boolean): ProofStatus {
  if (resultFingerprint === null) return 'empty';
  if (failed) return 'failed';
  if (resultFingerprint !== currentFingerprint) return 'stale';
  return decoded ? 'verified' : 'decoding';
}
