import { describe, expect, it } from 'vitest';
import { navigateCamera, preflightCamera, recoverCamera, renderViewBounds } from '../src/core/camera';
import { CopyLimitError, enumerateCopies, preflightCopies } from '../src/core/geometry';
import { historyReducer, initialHistory } from '../src/core/history';
import { fitCamera, MAX_ZOOM, MIN_ZOOM, screenToModel, zoomAt } from '../src/core/transforms';
import type { Camera, Mode } from '../src/core/types';
import { asset, document, placement } from './fixtures';

const size = { width: 1000, height: 500 };
const center = { x: 500, y: 250 };
const assets = new Map([['a', asset(4096, 4096)]]);
const doc = document({ placements: [placement({ x: 50, y: 50 })] });
const centered = (z: number): Camera => ({ x: 500 - 50 * z, y: 250 - 50 * z, z });

// The 4096px motif extends from -1998 to 2098 on each axis. All expectations
// below come from these endpoints, lattice steps and the one-screen-pixel pad.
describe('camera recovery: original P1 counterexample', () => {
  it('restores the smaller cell without changing history or placement transforms', () => {
    expect(preflightCamera(doc, assets, centered(8), size).count).toBe(1763); // 43 × 41
    const enlarged = { ...doc, W: 1000 };
    let history = historyReducer(initialHistory(doc), { type: 'commit', value: enlarged });
    expect(preflightCamera(enlarged, assets, centered(.2), size).count).toBe(603); // 9 × 67
    history = historyReducer(history, { type: 'undo' });
    expect(history.present).toBe(doc);
    expect(() => preflightCamera(history.present, assets, centered(.2), size)).toThrow(CopyLimitError); // 91 × 67 = 6097
    const before = JSON.stringify(history);
    const recovered = recoverCamera(history.present, assets, centered(.2), size);
    expect(recovered).toEqual(centered(3.2));
    expect(preflightCamera(doc, assets, recovered, size).count).toBe(1935); // 45 × 43
    expect(screenToModel(center, recovered)).toEqual({ x: 50, y: 50 });
    expect(JSON.stringify(history)).toBe(before);
    expect(history.present.placements).toBe(doc.placements);
    expect(history.past).toHaveLength(0); expect(history.future).toEqual([enlarged]);
    history = historyReducer(history, { type: 'redo' });
    expect(history.present).toBe(enlarged);
    expect(recoverCamera(history.present, assets, recovered, size)).toBe(recovered);
    history = historyReducer(history, { type: 'undo' });
    expect(recoverCamera(history.present, assets, recovered, size)).toBe(recovered);
    // Export preflight is independent of navigation, and remains unchanged.
    expect(preflightCopies(doc, assets, { left: -1, top: -1, right: 101, bottom: 101 }).count).toBe(1681); // 41 × 41
  });

  it('also recovers when Redo is the operation that restores the dense cell', () => {
    const enlarged = { ...doc, W: 1000 };
    let history = historyReducer(initialHistory(enlarged), { type: 'commit', value: doc });
    history = historyReducer(history, { type: 'undo' });
    expect(preflightCamera(history.present, assets, centered(.2), size).count).toBe(603);
    history = historyReducer(history, { type: 'redo' });
    const snapshot = JSON.stringify(history);
    expect(recoverCamera(history.present, assets, centered(.2), size)).toEqual(centered(3.2));
    expect(JSON.stringify(history)).toBe(snapshot);
    expect(history.present).toBe(doc);
    expect(history.past).toEqual([enlarged]); expect(history.future).toEqual([]);
  });

  it.each([
    ['straight', 1935], // 45 × 43
    ['half-drop', 1913], // 23 even columns × 43 + 22 odd columns × 42
    ['brick', 1913], // 21 even rows × 45 + 22 odd rows × 44
  ] as const)('%s recovers the dense view and preserves its model center', (mode: Mode, count: number) => {
    const documentInMode = { ...doc, mode };
    const recovered = recoverCamera(documentInMode, assets, centered(.2), size);
    expect(recovered).toEqual(centered(3.2));
    expect(preflightCamera(documentInMode, assets, recovered, size).count).toBe(count);
    expect(enumerateCopies(documentInMode, assets, renderViewBounds(recovered, size))).toHaveLength(count);
  });

  it('Fit falls back from 2115 copies to 1935 instead of rejecting forever', () => {
    const requested = fitCamera(doc, size.width, size.height);
    expect(requested.z).toBeCloseTo(50 / 31); // 500 / (100 × 3.1)
    expect(() => preflightCamera(doc, assets, requested, size)).toThrow(CopyLimitError); // 47 × 45
    const recovered = recoverCamera(doc, assets, requested, size);
    expect(recovered.z).toBeCloseTo(100 / 31);
    expect(screenToModel(center, recovered).x).toBeCloseTo(50, 10);
    expect(screenToModel(center, recovered).y).toBeCloseTo(50, 10);
    expect(preflightCamera(doc, assets, recovered, size).count).toBe(1935);
  });

  it('a workspace expansion can recover without changing the centered model point', () => {
    const smaller = { width: 100, height: 100 };
    const before = { x: 0, y: 0, z: 1 };
    expect(preflightCamera(doc, assets, before, smaller).count).toBe(1681); // 41 × 41
    const resized = { ...before, x: before.x + 450, y: before.y + 200 };
    const recovered = recoverCamera(doc, assets, resized, size);
    expect(recovered).toEqual(centered(2));
    expect(screenToModel(center, recovered)).toEqual({ x: 50, y: 50 });
  });
});

describe('rejected-scene navigation and safety boundaries', () => {
  it('allows multiple wheel increments to accumulate even while intermediate scenes are rejected', () => {
    let camera = centered(.2);
    let error: string | null = null;
    for (let n = 1; n <= 5; n++) {
      const next = zoomAt(camera, center, Math.exp(.6)); // maximum single wheel step
      const navigation = navigateCamera(doc, assets, camera, next, size);
      expect(navigation.camera).toBe(next);
      camera = navigation.camera; error = navigation.error;
      expect(camera.z).toBeCloseTo(.2 * Math.exp(.6 * n));
      expect(screenToModel(center, camera).x).toBeCloseTo(50);
      expect(screenToModel(center, camera).y).toBeCloseTo(50);
      if (n <= 3) {
        expect(error).toMatch(/2,000/);
        expect(() => enumerateCopies(doc, assets, renderViewBounds(camera, size))).toThrow(CopyLimitError);
      }
    }
    expect(error).toBeNull();
    expect(preflightCamera(doc, assets, camera, size).count).toBe(1849); // 43 × 43
  });

  it('keeps an off-center wheel pointer fixed during recovery navigation', () => {
    const pointer = { x: 150, y: 90 };
    const current = centered(.2);
    const requested = zoomAt(current, pointer, Math.exp(.6));
    const navigation = navigateCamera(doc, assets, current, requested, size);
    expect(navigation.error).toMatch(/2,000/);
    expect(screenToModel(pointer, navigation.camera).x).toBeCloseTo(-1700);
    expect(screenToModel(pointer, navigation.camera).y).toBeCloseTo(-750);
  });

  it('rejects excessive zoom-out from a safe view rather than blanking it', () => {
    const current = centered(8);
    const saved = { ...current };
    expect(() => navigateCamera(doc, assets, current, centered(.2), size)).toThrow(CopyLimitError);
    expect(current).toEqual(saved);
  });

  it('returns an already-safe camera unchanged', () => {
    const current = centered(8);
    expect(recoverCamera(doc, assets, current, size)).toBe(current);
    expect(navigateCamera(doc, assets, current, current, size)).toEqual({ camera: current, error: null });
  });

  it('explicitly tests the maximum zoom when doubling would overshoot', () => {
    const small = document({ W: 1, H: 1 });
    const tiny = new Map([['a', asset(1, 1)]]);
    const square = { width: 200, height: 200 };
    const requested = { x: 100, y: 100, z: 4.1 };
    expect(() => preflightCamera(small, tiny, requested, square)).toThrow(CopyLimitError); // 51 × 51
    const recovered = recoverCamera(small, tiny, requested, square);
    expect(recovered).toEqual({ x: 100, y: 100, z: MAX_ZOOM });
    expect(preflightCamera(small, tiny, recovered, square).count).toBe(729); // 27 × 27
  });

  it('terminates after ten analytic checks when even maximum zoom cannot fit', () => {
    let reads = 0;
    const countedAsset = { ...asset(4096, 4096), get nativeW() { reads++; return 4096; } };
    const dense = document({ W: 1, H: 1 });
    expect(() => recoverCamera(dense, new Map([['a', countedAsset]]), centered(MIN_ZOOM), size)).toThrow(/800%.*Pan/);
    // 0.02, .04, .08, .16, .32, .64, 1.28, 2.56, 5.12, 8.
    // motifBounds reads nativeW twice per preflight; no enumeration occurs.
    expect(reads).toBe(20);
  });

  it('permits bounded panning from a rejected scene, including at maximum zoom', () => {
    const dense = document({ W: 1, H: 1 });
    const current = centered(MAX_ZOOM);
    const requested = { ...current, x: current.x + 30, y: current.y - 17 };
    const navigation = navigateCamera(dense, assets, current, requested, size);
    expect(navigation.camera).toBe(requested);
    expect(navigation.error).toMatch(/2,000/);
    expect(() => enumerateCopies(dense, assets, renderViewBounds(requested, size))).toThrow(CopyLimitError);
  });

  it('can pan from an over-limit maximum-zoom center into a safe one after resize', () => {
    const phased = { ...doc, W: 95, H: 94 };
    const before = { x: 500 - 97.5 * 8, y: 250 - 97 * 8, z: 8 };
    expect(preflightCamera(phased, assets, before, size).count).toBe(1936); // 44 × 44
    const wide = { width: 1500, height: 500 };
    const current = { ...before, x: before.x + 250 };
    expect(() => recoverCamera(phased, assets, current, wide)).toThrow(/800%/); // 46 × 44 = 2024
    const requested = { ...current, x: current.x + 380 };
    const navigation = navigateCamera(phased, assets, current, requested, wide);
    expect(navigation.error).toBeNull();
    expect(screenToModel({ x: 750, y: 250 }, navigation.camera)).toEqual({ x: 50, y: 97 });
    expect(preflightCamera(phased, assets, navigation.camera, wide).count).toBe(1980); // 45 × 44
  });

  it('counts an offscreen pinned node and never accepts the 2001st copy', () => {
    const tiny = new Map([['a', asset(1, 1)]]);
    const small = document();
    const strip = { width: 199900, height: 1 };
    const camera = { x: 1, y: 0, z: 1 };
    const pin = { id: 'p', i: -1, j: 0 };
    expect(preflightCamera(small, tiny, camera, strip).count).toBe(2000);
    expect(() => preflightCamera(small, tiny, camera, strip, pin)).toThrow(CopyLimitError);
    const recovered = recoverCamera(small, tiny, camera, strip, pin);
    expect(recovered.z).toBe(2);
    expect(preflightCamera(small, tiny, recovered, strip, pin).count).toBe(1001);
  });

  it.each([
    { x: NaN, y: 0, z: 1 }, { x: 0, y: Infinity, z: 1 },
    { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: .019 },
    { x: 0, y: 0, z: 8.01 }, { x: 0, y: 0, z: NaN },
  ])('never accepts an invalid camera, even from a rejected scene: %o', invalid => {
    expect(() => recoverCamera(doc, assets, invalid, size)).toThrow(/supported range/);
    expect(() => navigateCamera(doc, assets, centered(.2), invalid, size)).toThrow(/supported range/);
  });

  it('does not treat missing assets or unsafe numeric ranges as density failures', () => {
    expect(() => recoverCamera(doc, new Map(), centered(.2), size)).toThrow(/source image/);
    expect(() => navigateCamera(doc, new Map(), centered(.2), centered(1), size)).toThrow(/source image/);
    expect(() => recoverCamera(doc, assets, { x: 1e20, y: 0, z: 1 }, size)).toThrow(/safe numeric/);
    expect(() => navigateCamera(doc, assets, centered(.2), { x: 1e20, y: 0, z: 1 }, size)).toThrow(/safe numeric/);
  });

  it.each([{ width: 0, height: 1 }, { width: 1, height: -1 }, { width: Infinity, height: 1 }])('rejects invalid viewport sizes: %o', invalid => {
    expect(() => recoverCamera(doc, assets, centered(.2), invalid)).toThrow(/viewport size/);
  });

  it('keeps the normal several-repeat Fit for a sparse document', () => {
    const small = document();
    const tiny = new Map([['a', asset(20, 20)]]);
    const requested = fitCamera(small, size.width, size.height);
    expect(recoverCamera(small, tiny, requested, size)).toBe(requested);
  });
});
