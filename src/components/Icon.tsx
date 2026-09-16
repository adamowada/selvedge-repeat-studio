import type { CSSProperties } from 'react';

const paths = {
  alert: 'M12 3 2 21h20L12 3Zm0 6v5m0 3v.1',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
  duplicate: 'M8 8h12v12H8zM16 8V4H4v12h4',
  trash: 'M4 6h16M9 6V3h6v3M7 6l1 15h8l1-15M10 10v7m4-7v7',
  flipH: 'M12 3v18M3 7l6 5-6 5zM21 7l-6 5 6 5z',
  flipV: 'M3 12h18M7 3l5 6 5-6zM7 21l5-6 5 6z',
  front: 'M8 8h12v12H8zM16 8V4H4v12h4m4-4h4',
  back: 'M4 4h12v12H4zM16 8h4v12H8v-4',
  fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  grid: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  grip: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
