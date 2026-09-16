import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPngSize } from '../src/core/png';

// The same three asymmetric alpha PNGs are loaded by the demo and browser tests.
const files = [['coral-stem.png', 280, 360], ['sage-sprig.png', 320, 260], ['ochre-petal.png', 220, 200]] as const;
describe('PNG pre-decode validation and shared fixtures', () => {
  it.each(files)('%s has its hand-specified size and RGBA format', (file, width, height) => {
    const bytes = readFileSync(new URL(`../public/demo/${file}`, import.meta.url));
    expect(readPngSize(bytes)).toEqual({ width, height });
    expect(bytes[25]).toBe(6); // PNG color type 6: truecolor + alpha.
  });
  it('rejects a renamed non-PNG before decoding', () => {
    expect(() => readPngSize(new TextEncoder().encode('not an image at all, despite the filename.png'))).toThrow(/valid PNG/);
  });
  it('rejects invalid or excessive dimensions before decoding/allocation', () => {
    const bytes = new Uint8Array(readFileSync(new URL('../public/demo/coral-stem.png', import.meta.url)));
    new DataView(bytes.buffer).setUint32(16, 4097);
    expect(() => readPngSize(bytes)).toThrow(/4097/);
    new DataView(bytes.buffer).setUint32(16, 0);
    expect(() => readPngSize(bytes)).toThrow(/0 × 360/);
  });
});
