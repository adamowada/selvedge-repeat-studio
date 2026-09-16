import { describe, expect, it } from 'vitest';
import { enumerateCopies, lattice, motifBounds, outputSize, preflightCopies, translation, validateDocument } from '../src/core/geometry';
import { asset, document, placement } from './fixtures';

const view = { left: 0, top: 0, right: 100, bottom: 100 };
const assets = new Map([['a', asset()]]);
const indices = (copies: ReturnType<typeof enumerateCopies>) => copies.map(c => [c.i, c.j]);

describe('hand-calculated lattices and output rectangles', () => {
  it('straight basis and negative translation', () => {
    expect(lattice(100, 80, 'straight')).toEqual({ a: { x: 100, y: 0 }, b: { x: 0, y: 80 } });
    expect(translation(100, 80, 'straight', -2, 3)).toEqual({ x: -200, y: 240 });
  });
  it('half-drop basis and negative translation', () => {
    expect(lattice(100, 80, 'half-drop')).toEqual({ a: { x: 100, y: 40 }, b: { x: 0, y: 80 } });
    expect(translation(100, 80, 'half-drop', -2, 3)).toEqual({ x: -200, y: 160 });
  });
  it('brick basis and negative translation', () => {
    expect(lattice(100, 80, 'brick')).toEqual({ a: { x: 100, y: 0 }, b: { x: 50, y: 80 } });
    expect(translation(100, 80, 'brick', -2, 3)).toEqual({ x: -50, y: 240 });
  });
  it('does not round odd half-pixel offsets', () => {
    expect(translation(5, 7, 'half-drop', 1, -1)).toEqual({ x: 5, y: -3.5 });
    expect(translation(5, 7, 'brick', -1, 1)).toEqual({ x: -2.5, y: 7 });
    expect(outputSize(document({ W: 5, H: 7 }))).toEqual({ width: 5, height: 7 });
    expect(outputSize(document({ W: 5, H: 7, mode: 'half-drop' }))).toEqual({ width: 10, height: 7 });
    expect(outputSize(document({ W: 5, H: 7, mode: 'brick' }))).toEqual({ width: 5, height: 14 });
  });
});
describe('transformed bounds', () => {
  it('90° rotation, 2× scale, negative center', () => {
    const b = motifBounds(placement({ x: -10, y: 5, s: 2, deg: 90 }), asset(40, 20));
    expect(b.left).toBeCloseTo(-30); expect(b.right).toBeCloseTo(10);
    expect(b.top).toBeCloseTo(-35); expect(b.bottom).toBeCloseTo(45);
  });
  it('45° square has 10√2 half-extents; flips do not change its AABB', () => {
    const p = placement({ deg: 45, flipX: true, flipY: true });
    const b = motifBounds(p, asset(20, 20));
    expect(b.left).toBeCloseTo(-14.1421356237); expect(b.top).toBeCloseTo(-14.1421356237);
    expect(b.right).toBeCloseTo(14.1421356237); expect(b.bottom).toBeCloseTo(14.1421356237);
  });
});
describe('enumeration (not a fixed 3×3)', () => {
  it('includes all four corner copies', () => {
    expect(indices(enumerateCopies(document(), assets, view))).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
  });
  it('uses a negative viewport without modulo or recentering', () => {
    expect(indices(enumerateCopies(document(), assets, { left: -110, top: -110, right: -90, bottom: -90 }))).toEqual([[-1, -1]]);
  });
  it('large motif at a negative position needs 12 explicit copies beyond i=1', () => {
    const copies = enumerateCopies(document({ placements: [placement({ x: -175, y: -50 })] }), new Map([['a', asset(300, 180)]]), view);
    expect(indices(copies)).toEqual([[1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2], [4, 0], [4, 1], [4, 2]]);
  });
  it('rotated, oversized motif covers shifted rows', () => {
    const copies = enumerateCopies(document({ placements: [placement({ x: -25, y: 50, deg: 90 })] }), new Map([['a', asset(240, 40)]]), view);
    expect(indices(copies)).toEqual([[1, -1], [1, 0], [1, 1]]);
  });
  it('odd half-drop counts parity analytically', () => {
    const copies = enumerateCopies(document({ W: 5, H: 7, mode: 'half-drop' }), new Map([['a', asset(2, 2)]]), { left: 0, top: 0, right: 5, bottom: 7 });
    expect(indices(copies)).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(copies[2]).toMatchObject({ tx: 5, ty: 3.5 });
  });
  it('odd brick sorts numerically by i then j, not by generation row', () => {
    expect(indices(enumerateCopies(document({ W: 5, H: 7, mode: 'brick' }), new Map([['a', asset(2, 2)]]), { left: 0, top: 0, right: 5, bottom: 7 }))).toEqual([[0, 0], [0, 1], [1, 0]]);
  });
  it('negative odd half-drop parity is floor-based', () => {
    expect(indices(enumerateCopies(document({ W: 5, H: 7, mode: 'half-drop' }), new Map([['a', asset(2, 2)]]), { left: -5, top: -7, right: 0, bottom: 0 }))).toEqual([[-1, 0], [0, -1], [0, 0]]);
  });
  it('preserves placement stacking before numeric copy ordering', () => {
    const doc = document({ placements: [placement({ id: 'z' }), placement({ id: 'a' })] });
    expect(enumerateCopies(doc, assets, view).map(c => c.id)).toEqual(['z', 'z', 'z', 'z', 'a', 'a', 'a', 'a']);
    expect(indices(enumerateCopies(document(), assets, { left: -1110, right: -790, top: 40, bottom: 60 }))).toEqual([]);
    expect(indices(enumerateCopies(document(), assets, { left: -1110, right: -790, top: -1, bottom: 1 }))).toEqual([[-11, 0], [-10, 0], [-9, 0], [-8, 0]]);
  });
  it('pins an active copy exactly once even outside the viewport', () => {
    expect(indices(enumerateCopies(document(), assets, view, { id: 'p', i: 9, j: -7 }))).toEqual([[0, 0], [0, 1], [1, 0], [1, 1], [9, -7]]);
    expect(enumerateCopies(document(), assets, view, { id: 'p', i: 1, j: 1 })).toHaveLength(4);
  });
  it('preflights huge counts and unsafe ranges without entering copy loops', () => {
    expect(() => enumerateCopies(document({ W: 1, H: 1 }), assets, { left: -1e8, top: -1e8, right: 1e8, bottom: 1e8 })).toThrow(/2,000|safe numeric/);
    expect(() => enumerateCopies(document(), assets, { left: 1e20, top: 0, right: 1e20, bottom: 100 })).toThrow(/safe numeric/);
    // i=-8×10^15 and inner interval near 8×10^15 are individually safe;
    // staggering needs j≈12×10^15, beyond integer precision. Reject before loops.
    expect(() => preflightCopies(document({ W: 1, H: 1, mode: 'half-drop' }), new Map([['a', asset(1, 1)]]), { left: -8e15, right: -8e15, top: 8e15, bottom: 8e15 })).toThrow(/safe numeric/);
    expect(() => preflightCopies(document({ W: 1, H: 1, mode: 'brick' }), new Map([['a', asset(1, 1)]]), { left: 8e15, right: 8e15, top: -8e15, bottom: -8e15 })).toThrow(/safe numeric/);
  });
  it('allows 2000 copies, refuses the 2001st pinned copy', () => {
    const a = new Map([['a', asset(1, 1)]]);
    const strip = { left: 0, right: 1999 * 100, top: 0, bottom: 0 };
    expect(preflightCopies(document(), a, strip).count).toBe(2000);
    expect(() => preflightCopies(document(), a, strip, { id: 'p', i: -1, j: 0 })).toThrow(/2,000/);
  });
  it('validates all placements before any copy enumeration', () => {
    const doc = document({ placements: [placement(), placement({ id: 'second', s: 100000 })] });
    expect(() => enumerateCopies(doc, assets, view)).toThrow(/2,000/);
  });
});
describe('commit validation', () => {
  it.each([0, -1, 1.5, NaN, Infinity, 4097])('rejects invalid cell size %s', n => {
    expect(() => validateDocument(document({ W: n }), assets)).toThrow();
  });
  it('checks doubled export bounds and positive scale', () => {
    expect(() => validateDocument(document({ W: 2049, mode: 'half-drop' }), assets)).toThrow(/4098/);
    expect(() => validateDocument(document({ H: 2049, mode: 'brick' }), assets)).toThrow(/4098/);
    expect(() => validateDocument(document({ placements: [placement({ s: 0 })] }), assets)).toThrow(/scale/);
    expect(() => validateDocument(document({ W: 4096 }), assets)).not.toThrow();
  });
});
