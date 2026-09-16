import {
  MAX_COPIES, MAX_SIDE, type Asset, type AssetMap, type Bounds, type Copy,
  type CopyKey, type Mode, type Placement, type Point, type RepeatDocument,
} from './types';

// Distinguish a recoverable scene-density rejection from invalid data/ranges.
export class CopyLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'CopyLimitError'; }
}

export function lattice(W: number, H: number, mode: Mode): { a: Point; b: Point } {
  return {
    a: { x: W, y: mode === 'half-drop' ? H / 2 : 0 },
    b: { x: mode === 'brick' ? W / 2 : 0, y: H },
  };
}
export function translation(W: number, H: number, mode: Mode, i: number, j: number): Point {
  const { a, b } = lattice(W, H, mode);
  return { x: i * a.x + j * b.x, y: i * a.y + j * b.y };
}
export function motifBounds(p: Placement, asset: Pick<Asset, 'nativeW' | 'nativeH'>): Bounds {
  const angle = p.deg * Math.PI / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const hx = p.s * (c * asset.nativeW + s * asset.nativeH) / 2;
  const hy = p.s * (s * asset.nativeW + c * asset.nativeH) / 2;
  return { left: p.x - hx, right: p.x + hx, top: p.y - hy, bottom: p.y + hy };
}
export const padBounds = (b: Bounds, margin: number): Bounds => ({
  left: b.left - margin, right: b.right + margin,
  top: b.top - margin, bottom: b.bottom + margin,
});
export function outputSize(doc: Pick<RepeatDocument, 'W' | 'H' | 'mode'>) {
  return { width: doc.W * (doc.mode === 'half-drop' ? 2 : 1), height: doc.H * (doc.mode === 'brick' ? 2 : 1) };
}
export function validateDocument(doc: RepeatDocument, assets: ReadonlyMap<string, Pick<Asset, 'nativeW' | 'nativeH'>>): void {
  if (!Number.isInteger(doc.W) || !Number.isInteger(doc.H) || doc.W < 1 || doc.H < 1 || doc.W > MAX_SIDE || doc.H > MAX_SIDE) {
    throw new Error(`Cell width and height must be whole pixels from 1 to ${MAX_SIDE}.`);
  }
  if (!['straight', 'half-drop', 'brick'].includes(doc.mode)) throw new Error('Unknown repeat mode.');
  const size = outputSize(doc);
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
    throw new Error(`The export would be ${size.width} × ${size.height} px. Each side must be ≤ ${MAX_SIDE} px.`);
  }
  if (doc.background !== null && !/^#[0-9a-f]{6}$/i.test(doc.background)) throw new Error('Choose a valid background color.');
  const ids = new Set<string>();
  for (const p of doc.placements) {
    const a = assets.get(p.assetId);
    if (!a) throw new Error('A placement has no source image.');
    if (a.nativeW < 1 || a.nativeH < 1 || a.nativeW > MAX_SIDE || a.nativeH > MAX_SIDE) throw new Error('Source image exceeds the pixel limit.');
    if (ids.has(p.id)) throw new Error('Placement IDs must be unique.');
    ids.add(p.id);
    if (![p.x, p.y, p.s, p.deg].every(Number.isFinite) || p.s <= 0) throw new Error('Transforms must be finite; scale must be greater than zero.');
  }
}

// A run is a set of rows/columns with the same parity. Staggering shifts its
// inner interval by floor(outer / 2). Counting these runs is O(placements),
// even when a rejected request would produce billions of copies.
interface Run { first: number; last: number; step: 1 | 2; lo: number; hi: number; shifted: boolean }
interface Plan { id: string; runs: Run[]; swapped: boolean; count: number }
function safeInteger(n: number) {
  if (!Number.isSafeInteger(n)) throw new Error('Copy coordinates exceed safe numeric bounds.');
  return n === 0 ? 0 : n; // Canonicalize Math.ceil’s negative zero.
}
function runCount(r: Run) {
  if (r.first > r.last || r.lo > r.hi) return 0;
  if (r.shifted) {
    // Each staggered run moves its inner endpoints monotonically. Check both
    // extremes before loops: finite unshifted indices can overflow after this
    // subtraction, where JavaScript's index++ would otherwise stop advancing.
    const last = r.first + Math.floor((r.last - r.first) / r.step) * r.step;
    for (const outer of [r.first, last]) {
      safeInteger(r.lo - Math.floor(outer / 2));
      safeInteger(r.hi - Math.floor(outer / 2));
    }
  }
  return safeInteger((Math.floor((r.last - r.first) / r.step) + 1) * (r.hi - r.lo + 1));
}
function rangePlan(doc: RepeatDocument, p: Placement, asset: Asset, view: Bounds): Plan {
  const b = motifBounds(p, asset);
  const dx0 = (view.left - b.right) / doc.W;
  const dx1 = (view.right - b.left) / doc.W;
  const dy0 = (view.top - b.bottom) / doc.H;
  const dy1 = (view.bottom - b.top) / doc.H;
  const swapped = doc.mode === 'brick';
  const first = safeInteger(Math.ceil(swapped ? dy0 : dx0));
  const last = safeInteger(Math.floor(swapped ? dy1 : dx1));
  const inner0 = swapped ? dx0 : dy0;
  const inner1 = swapped ? dx1 : dy1;
  const runs: Run[] = [];
  if (doc.mode === 'straight') {
    runs.push({ first, last, step: 1, lo: safeInteger(Math.ceil(inner0)), hi: safeInteger(Math.floor(inner1)), shifted: false });
  } else {
    for (const parity of [0, 1]) {
      const start = safeInteger(2 * Math.ceil((first - parity) / 2) + parity);
      runs.push({ first: start, last, step: 2, lo: safeInteger(Math.ceil(inner0 - parity / 2)), hi: safeInteger(Math.floor(inner1 - parity / 2)), shifted: true });
    }
  }
  return { id: p.id, runs, swapped, count: runs.reduce((n, r) => n + runCount(r), 0) };
}
function planContains(plan: Plan, c: CopyKey) {
  const outer = plan.swapped ? c.j : c.i;
  const inner = plan.swapped ? c.i : c.j;
  return plan.runs.some(r => {
    const shift = r.shifted ? Math.floor(outer / 2) : 0;
    return outer >= r.first && outer <= r.last && (outer - r.first) % r.step === 0 && inner >= r.lo - shift && inner <= r.hi - shift;
  });
}
export function preflightCopies(doc: RepeatDocument, assets: AssetMap, view: Bounds, pin?: CopyKey | null) {
  if (![view.left, view.right, view.top, view.bottom].every(Number.isFinite) || view.right < view.left || view.bottom < view.top) throw new Error('Invalid viewport.');
  const plans: Plan[] = [];
  let count = 0;
  for (const p of doc.placements) {
    const asset = assets.get(p.assetId);
    if (!asset) throw new Error('A placement has no source image.');
    const plan = rangePlan(doc, p, asset, view);
    count += plan.count;
    if (!Number.isSafeInteger(count) || count > MAX_COPIES) throw new CopyLimitError(`This view needs more than ${MAX_COPIES.toLocaleString()} copies. Zoom in, enlarge the cell, or reduce motif size/count.`);
    plans.push(plan);
  }
  let extra: CopyKey | null = null;
  if (pin) {
    safeInteger(pin.i); safeInteger(pin.j);
    const plan = plans.find(p => p.id === pin.id);
    if (plan && !planContains(plan, pin)) { extra = pin; count++; }
  }
  if (count > MAX_COPIES) throw new CopyLimitError(`This view exceeds the ${MAX_COPIES.toLocaleString()}-copy limit, including the active copy.`);
  return { plans, count, extra };
}
export function enumerateCopies(doc: RepeatDocument, assets: AssetMap, view: Bounds, pin?: CopyKey | null): Copy[] {
  const { plans, extra } = preflightCopies(doc, assets, view, pin);
  const copies: Copy[] = [];
  // No copy loop or node allocation occurs until *all* plans pass the limit.
  for (const plan of plans) {
    const group: Copy[] = [];
    const append = (i: number, j: number) => {
      const t = translation(doc.W, doc.H, doc.mode, i, j);
      group.push({ id: plan.id, i, j, tx: t.x, ty: t.y });
    };
    for (const r of plan.runs) {
      if (r.lo > r.hi) continue;
      for (let outer = r.first; outer <= r.last; outer += r.step) {
        const shift = r.shifted ? Math.floor(outer / 2) : 0;
        for (let inner = r.lo - shift; inner <= r.hi - shift; inner++) {
          append(plan.swapped ? inner : outer, plan.swapped ? outer : inner);
        }
      }
    }
    if (extra?.id === plan.id) append(extra.i, extra.j);
    group.sort((a, b) => a.i - b.i || a.j - b.j);
    copies.push(...group);
  }
  return copies;
}
