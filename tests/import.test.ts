import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createImportBudget, importBatch, importPng, MAX_ASSETS, MAX_IMPORT_BYTES, MAX_IMPORT_PIXELS, releaseAssets } from '../src/core/png';

const decode = vi.fn(async () => {});
const revoke = vi.fn();
function file() {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 8); view.setUint32(20, 8);
  return new File([bytes], 'test.png');
}
beforeEach(() => {
  decode.mockReset().mockResolvedValue(undefined);
  revoke.mockClear();
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 8; naturalHeight = 8; decode = decode; });
  const data = new Uint8ClampedArray(8 * 8 * 4);
  data[(3 * 8 + 4) * 4 + 3] = 128;
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reserves shared capacity across concurrent decodes and releases it exactly once', async () => {
  const budget = { ...createImportBudget(), count: MAX_ASSETS - 1 };
  let finish!: () => void;
  decode.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = importPng(file(), budget);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  await expect(importPng(file(), budget)).rejects.toThrow('Source limit');
  expect(decode).toHaveBeenCalledOnce();
  finish();
  const asset = await first;
  expect(budget).toEqual({ count: MAX_ASSETS, pixels: 64, bytes: 24 });
  expect(asset.contentBounds).toEqual({ x: 3, y: 2, width: 3, height: 3 });
  releaseAssets([asset]); releaseAssets([asset]);
  expect(budget).toEqual({ count: MAX_ASSETS - 1, pixels: 0, bytes: 0 });
  expect(revoke).toHaveBeenCalledOnce();
  expect(asset.image.src).toBe('');
  releaseAssets([await importPng(file(), budget)]);
});

it.each([
  { count: MAX_ASSETS, pixels: 0, bytes: 0 },
  { count: 0, pixels: MAX_IMPORT_PIXELS - 63, bytes: 0 },
  { count: 0, pixels: 0, bytes: MAX_IMPORT_BYTES - 23 },
])('rejects aggregate limits before decoding: %j', async budget => {
  const before = { ...budget };
  await expect(importPng(file(), budget)).rejects.toThrow('Source limit');
  expect(budget).toEqual(before);
  expect(decode).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('accepts exact budget boundaries', async () => {
  const budget = { count: MAX_ASSETS - 1, pixels: MAX_IMPORT_PIXELS - 64, bytes: MAX_IMPORT_BYTES - 24 };
  const asset = await importPng(file(), budget);
  expect(budget).toEqual({ count: MAX_ASSETS, pixels: MAX_IMPORT_PIXELS, bytes: MAX_IMPORT_BYTES });
  releaseAssets([asset]);
});

it('releases failed decodes and continues importing the rest of a batch', async () => {
  decode.mockRejectedValueOnce(new Error('Corrupt image'));
  const budget = createImportBudget();
  const batch = await importBatch([file(), file()], budget);
  expect(batch.errors).toEqual(['test.png: Corrupt image']);
  expect(batch.assets).toHaveLength(1);
  expect(budget).toEqual({ count: 1, pixels: 64, bytes: 24 });
  releaseAssets(batch.assets);
  expect(budget).toEqual(createImportBudget());
  expect(revoke).toHaveBeenCalledTimes(2);
});
