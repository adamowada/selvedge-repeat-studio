import { describe, expect, it } from 'vitest';
import { imageProps, MAX_ZOOM, MIN_ZOOM, modelToScreen, placementFromNode, screenToModel, viewportBounds, zoomAt } from '../src/core/transforms';
import { changePlacement, cleanSelection, reorderPlacement } from '../src/core/document';
import { asset, document, placement } from './fixtures';

describe('screen vs model vs copy coordinates', () => {
  it('inverts pan/zoom only for raw pointers', () => {
    const camera = { x: 50, y: -30, z: 2 };
    expect(screenToModel({ x: 350, y: 170 }, camera)).toEqual({ x: 150, y: 100 });
    expect(modelToScreen({ x: 150, y: 100 }, camera)).toEqual({ x: 350, y: 170 });
    expect(viewportBounds(camera, 400, 200)).toEqual({ left: -25, top: 15, right: 175, bottom: 115 });
  });
  it.each([
    ['straight', { tx: 100, ty: -80 }, 50, 180],
    ['half-drop', { tx: 100, ty: -40 }, 50, 140],
    ['brick', { tx: 50, ty: -80 }, 100, 180],
  ] as const)('%s subtracts translation from already-model-parent node coordinates', (_mode, copy, x, y) => {
    const p = placementFromNode(placement(), copy, { x: 150, y: 100, scaleX: -2, scaleY: 2, rotation: 30 });
    expect(p).toMatchObject({ x, y, s: 2, deg: 30, flipX: true, flipY: false });
  });
  it('maps centered origin and both flip flags to shared image props', () => {
    expect(imageProps(placement({ x: 30, y: -40, s: 2, deg: 15, flipY: true }), asset(40, 80), { tx: -100, ty: 60 })).toMatchObject({ x: -70, y: 20, width: 40, height: 80, offsetX: 20, offsetY: 40, scaleX: 2, scaleY: -2, rotation: 15 });
  });
  it('pointer-centered zoom keeps (150, 100) beneath screen (350, 170)', () => {
    expect(zoomAt({ x: 50, y: -30, z: 2 }, { x: 350, y: 170 }, 2)).toEqual({ x: -250, y: -230, z: 4 });
    expect(zoomAt({ x: 0, y: 0, z: 1 }, { x: 0, y: 0 }, 100).z).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, z: 1 }, { x: 0, y: 0 }, .0001).z).toBe(MIN_ZOOM);
  });
});
describe('placement documents', () => {
  it('mode/cell changes keep exact transforms including negative centers and flips', () => {
    const doc = document({ placements: [placement({ x: -400, y: 1234, deg: 37, s: 2.7, flipY: true })] });
    const changed = { ...doc, W: 501, H: 301, mode: 'brick' as const };
    expect(changed.placements).toBe(doc.placements);
    expect(changed.placements[0]).toEqual({ id: 'p', assetId: 'a', x: -400, y: 1234, deg: 37, s: 2.7, flipX: false, flipY: true });
  });
  it('duplicates share an asset but have independent transforms; order is the stack', () => {
    const doc = document({ placements: [placement(), placement({ id: 'copy', x: 24, y: 24 })] });
    const next = changePlacement(doc, 'copy', { x: 50 });
    expect(next.placements[0].x).toBe(0); expect(next.placements[1].x).toBe(50);
    expect(next.placements[1].assetId).toBe(next.placements[0].assetId);
    expect(reorderPlacement(next, 'copy', 'back').placements.map(p => p.id)).toEqual(['copy', 'p']);
    expect(reorderPlacement(next, 'p', 'front').placements.map(p => p.id)).toEqual(['copy', 'p']);
  });
  it('clears a stale selection after delete or undo of insertion', () => {
    expect(cleanSelection(document({ placements: [] }), { id: 'p', i: 4, j: -2 })).toBeNull();
  });
});
