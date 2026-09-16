import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { decodeProject, encodeProject, MAX_PROJECT_BYTES, readProject } from '../src/core/project';
import * as png from '../src/core/png';
import { INITIAL_DOCUMENT, type NamedAsset, type RepeatDocument } from '../src/core/types';

const bytes = new Uint8Array(readFileSync('public/demo/ochre-petal.png'));
const placement = { id: 'p', assetId: 'a', x: -10.125, y: 401.5, s: .4375, deg: -123.4, flipX: true, flipY: false };
const manifest = () => ({ format: 'selvedge-repeat', version: 1, document: { ...INITIAL_DOCUMENT, placements: [placement] }, assets: [{ id: 'a', name: '花 pétal', path: 'assets/0.png' }] });
const archive = (data: unknown = manifest(), sources: Record<string, Uint8Array> = { 'assets/0.png': bytes }) =>
  zipSync({ 'project.json': strToU8(JSON.stringify(data)), ...sources }, { level: 0 });
afterEach(() => vi.restoreAllMocks());

it('round-trips modes, exact transforms, stacking, names and original PNG bytes, including unused sources', async () => {
  const url = URL.createObjectURL(new Blob([bytes]));
  try {
    const sources: NamedAsset[] = ['a', 'unused'].map(id => ({ id, name: '花 pétal', image: { src: url } as HTMLImageElement, nativeW: 220, nativeH: 200 }));
    for (const mode of ['straight', 'half-drop', 'brick'] as const) {
      const doc: RepeatDocument = { ...INITIAL_DOCUMENT, mode, background: null, placements: [placement, { ...placement, id: 'top', flipX: false, flipY: true }] };
      const saved = new Uint8Array(await (await encodeProject(doc, sources)).arrayBuffer());
      const opened = readProject(saved);
      expect(opened.doc).toEqual(doc);
      expect(opened.sources.map(({ id, name }) => ({ id, name }))).toEqual(sources.map(({ id, name }) => ({ id, name })));
      expect(opened.sources.every(source => Buffer.from(source.bytes).equals(Buffer.from(bytes)))).toBe(true);
      expect(Object.keys(unzipSync(saved))).toEqual(['project.json', 'assets/0.png', 'assets/1.png']);
    }
    const empty = await encodeProject(INITIAL_DOCUMENT, []);
    expect(readProject(new Uint8Array(await empty.arrayBuffer()))).toEqual({ doc: INITIAL_DOCUMENT, sources: [] });
  } finally { URL.revokeObjectURL(url); }
});

it('rejects unsupported versions, missing sources, duplicate IDs and malformed document fields', () => {
  const cases = [
    { ...manifest(), version: 2 },
    { ...manifest(), assets: [] },
    { ...manifest(), assets: [...manifest().assets, ...manifest().assets] },
    ...[{ assetId: 'missing' }, { flipX: 'true' }, { s: 0 }, { deg: null }, { id: '' }].map(patch => ({
      ...manifest(), document: { ...INITIAL_DOCUMENT, placements: [{ ...placement, ...patch }] },
    })),
  ];
  for (const data of cases) expect(() => readProject(archive(data))).toThrow();
});

it('rejects unsafe archive entries, compression bombs, truncation and oversized declarations before decode', async () => {
  expect(() => readProject(archive(manifest(), { '../bad.png': bytes }))).toThrow();
  expect(() => readProject(zipSync({ 'project.json': new Uint8Array(2 * 1024 * 1024) }, { level: 9 }))).toThrow();
  expect(() => readProject(archive().slice(0, -30))).toThrow();
  const forged = archive(), view = new DataView(forged.buffer);
  for (let i = 0; i < forged.length - 28; i++) if (view.getUint32(i, true) === 0x02014b50) {
    view.setUint32(i + 20, MAX_PROJECT_BYTES, true); view.setUint32(i + 24, MAX_PROJECT_BYTES, true); break;
  }
  expect(() => readProject(forged)).toThrow('size limit');
  const largeImage = bytes.slice();
  new DataView(largeImage.buffer).setUint32(16, 4096); new DataView(largeImage.buffer).setUint32(20, 4096);
  const huge = manifest();
  huge.assets = Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, name: 'large', path: `assets/${i}.png` }));
  expect(() => readProject(archive(huge, Object.fromEntries(huge.assets.map(a => [a.path, largeImage]))))).toThrow('pixel limit');
  const file = { size: MAX_PROJECT_BYTES + 1, arrayBuffer: vi.fn() } as unknown as File;
  await expect(decodeProject(file)).rejects.toThrow('size limit');
  expect(file.arrayBuffer).not.toHaveBeenCalled();
});

it('disposes every successfully decoded source when a later PNG fails', async () => {
  const dispose = vi.fn();
  const importer = vi.spyOn(png, 'importPng').mockResolvedValueOnce({ id: 'generated', name: 'first', image: {} as HTMLImageElement, nativeW: 220, nativeH: 200, dispose })
    .mockRejectedValueOnce(new Error('Corrupt PNG'));
  const data = manifest(); data.assets.push({ id: 'b', name: 'second', path: 'assets/1.png' });
  await expect(decodeProject(new File([archive(data, { 'assets/0.png': bytes, 'assets/1.png': bytes })], 'test.selvedge'))).rejects.toThrow('Corrupt PNG');
  expect(importer).toHaveBeenCalledTimes(2);
  expect(importer.mock.calls[0][1]).toBe(importer.mock.calls[1][1]);
  expect(dispose).toHaveBeenCalledOnce();
});
