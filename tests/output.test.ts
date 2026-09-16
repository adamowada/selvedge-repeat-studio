import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Konva from '../src/core/konva';
import { downloadPng, exportPng, renderPixels } from '../src/core/export';
import { drawProof } from '../src/core/proof';
import { INITIAL_DOCUMENT } from '../src/core/types';

const io = vi.hoisted(() => ({
  destroy: vi.fn(), remove: vi.fn(), click: vi.fn(), close: vi.fn(), ratios: [] as number[],
  canvas: { width: 10, height: 10, toBlob: vi.fn() },
}));
// Test allocation/cleanup and asynchronous failures; Playwright verifies real pixels.
vi.mock('../src/core/konva', () => {
  const konva = {
    pixelRatio: 2,
    Stage: class { constructor() { io.ratios.push(konva.pixelRatio); } add() {} destroy = io.destroy; toCanvas() { return io.canvas; } },
    Layer: class { add() {} draw() {} }, Rect: class {}, Image: class {},
  };
  return { default: konva };
});
beforeEach(() => {
  vi.clearAllMocks(); io.ratios.length = 0; Konva.pixelRatio = 2;
  io.canvas.width = io.canvas.height = 10;
  io.canvas.toBlob.mockImplementation(callback => callback(new Blob(['png'])));
  vi.stubGlobal('document', { createElement: () => ({ remove: io.remove, click: io.click }), body: { append() {} } });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1000, height: 1000, close: io.close })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('exports on a 1:1 isolated surface, restores the live pixel ratio and closes all temporary resources', async () => {
  const result = await exportPng(INITIAL_DOCUMENT, new Map());
  expect(result).toMatchObject({ width: 1000, height: 1000, fingerprint: JSON.stringify(INITIAL_DOCUMENT) });
  expect(io.ratios).toEqual([1]); expect(Konva.pixelRatio).toBe(2);
  expect(io.destroy).toHaveBeenCalledOnce(); expect(io.remove).toHaveBeenCalledOnce();
  expect(io.close).toHaveBeenCalledOnce();
  expect(io.canvas).toMatchObject({ width: 0, height: 0 });
});

it('rejects invalid output before allocation and cleans up when encoding fails', async () => {
  await expect(renderPixels(INITIAL_DOCUMENT, new Map(), 4097, 1000)).rejects.toThrow('Output sides');
  expect(io.ratios).toEqual([]);
  io.canvas.toBlob.mockImplementation(callback => callback(null));
  await expect(exportPng(INITIAL_DOCUMENT, new Map())).rejects.toThrow('could not encode');
  expect(io.destroy).toHaveBeenCalledOnce(); expect(Konva.pixelRatio).toBe(2);
  expect(io.canvas.width).toBe(0);
});

it('rejects a dimension mismatch and closes the decoded bitmap', async () => {
  vi.mocked(createImageBitmap).mockResolvedValue({ width: 1, height: 1, close: io.close } as ImageBitmap);
  await expect(exportPng(INITIAL_DOCUMENT, new Map())).rejects.toThrow('dimensions');
  expect(io.close).toHaveBeenCalledOnce();
});

it('releases download URLs even when initiation throws', () => {
  vi.useFakeTimers(); vi.stubGlobal('window', globalThis);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  io.click.mockImplementationOnce(() => { throw new Error('Download failed'); });
  expect(() => downloadPng({ blob: new Blob(), width: 1, height: 1, fingerprint: '' })).toThrow('Download failed');
  expect(io.remove).toHaveBeenCalledOnce(); expect(revoke).not.toHaveBeenCalled();
  vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:download');
});

it.each(['success', 'aborted', 'oversized', 'no-context', 'no-pattern'] as const)('proof %s always closes its bitmap', async mode => {
  const blob = new Blob(['exact download']);
  const pattern = { setTransform: vi.fn() }, context = { createPattern: vi.fn(() => mode === 'no-pattern' ? null : pattern), clearRect: vi.fn(), fillRect: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => mode === 'no-context' ? null : context } as unknown as HTMLCanvasElement;
  vi.stubGlobal('DOMMatrix', class { scale() { return this; } });
  vi.mocked(createImageBitmap).mockResolvedValue({ width: mode === 'oversized' ? 4097 : 100, height: 100, close: io.close } as ImageBitmap);
  const controller = new AbortController(); if (mode === 'aborted') controller.abort();
  const pending = drawProof(blob, canvas, controller.signal);
  if (mode === 'success' || mode === 'aborted') await pending;
  else await expect(pending).rejects.toThrow();
  expect(createImageBitmap).toHaveBeenCalledWith(blob);
  expect(io.close).toHaveBeenCalledOnce();
  if (mode === 'success') {
    expect(canvas).toMatchObject({ width: 576, height: 432 });
    expect(pattern.setTransform).toHaveBeenCalledOnce();
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 576, 432);
  } else expect(context.fillRect).not.toHaveBeenCalled();
});
