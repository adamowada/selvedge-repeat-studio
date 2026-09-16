// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStudio, type Studio } from '../src/hooks/useStudio';
import { Inspector } from '../src/components/Inspector';
import { ProofPanel } from '../src/components/ProofPanel';
import App from '../src/App';
import { importBatch, releaseAssets } from '../src/core/png';
import { downloadPng, exportPng } from '../src/core/export';
import { drawProof } from '../src/core/proof';
import type { NamedAsset } from '../src/core/types';

vi.mock('../src/core/png', async original => ({ ...await original<object>(), importBatch: vi.fn(), releaseAssets: vi.fn() }));
vi.mock('../src/core/export', () => ({ exportPng: vi.fn(), downloadPng: vi.fn(), documentFingerprint: JSON.stringify }));
vi.mock('../src/core/proof', () => ({ drawProof: vi.fn() }));
// Real canvas/gesture integration is exercised by Playwright, not a fake jsdom canvas.
vi.mock('../src/components/Workspace', () => ({ Workspace: () => <div /> }));
let studio: Studio, root: Root, host: HTMLDivElement;
const asset: NamedAsset = { id: 'a', name: 'motif', nativeW: 8, nativeH: 8, image: {} as HTMLImageElement };
function Harness() { studio = useStudio(); return null; }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  vi.mocked(importBatch).mockResolvedValue({ assets: [asset], errors: [] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  act(() => studio.onSize({ width: 800, height: 600 }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function importAndInsert() {
  await act(async () => studio.onFiles([new File([], 'motif.png')]));
  act(() => studio.insert(asset));
}

it('keyboard transforms validate, preserve unrelated current fields, and undo/redo once per commit', async () => {
  await importAndInsert();
  const p = studio.history.present.placements[0], oldCommit = studio.commitTransform;
  act(() => { oldCommit(p.id, { s: .7 }); oldCommit(p.id, { deg: 45 }); });
  expect(studio.history.present.placements[0]).toMatchObject({ s: .7, deg: 45 });
  act(() => { expect(studio.commitTransform(p.id, { s: 0 })).toBe(false); });
  expect(studio.history.present.placements[0].s).toBe(.7);
  act(() => studio.action('undo'));
  expect(studio.history.present.placements[0]).toMatchObject({ s: .7, deg: 0 });
  act(() => studio.action('redo'));
  expect(studio.history.present.placements[0].deg).toBe(45);
  act(() => { studio.nudge(1, 0); expect(studio.commitTransform(p.id, { s: .9 })).toBe(false); studio.endNudge(); });
  expect(studio.history.present.placements[0].s).toBe(.7);
});

it('removes unused assets but retains sources reachable from undo/redo history', async () => {
  await act(async () => studio.onFiles([new File([], 'motif.png')]));
  act(() => studio.removeAsset(asset.id));
  expect(studio.assets).toHaveLength(0);
  expect(releaseAssets).toHaveBeenCalledWith([asset]);
  await importAndInsert();
  act(() => studio.action('delete'));
  expect(studio.retainedAssets.has(asset.id)).toBe(true);
  act(() => studio.removeAsset(asset.id));
  expect(studio.assets).toHaveLength(1);
  act(() => studio.action('undo'));
  expect(studio.history.present.placements[0].assetId).toBe(asset.id);
  act(() => studio.selectPlacement(studio.history.present.placements[0].id));
  act(() => studio.action('delete'));
  act(() => { for (let i = 0; i < 51; i++) studio.commitSettings({ W: 500 + i }); });
  expect(studio.retainedAssets.has(asset.id)).toBe(false);
  act(() => studio.removeAsset(asset.id));
  expect(studio.assets).toHaveLength(0);
});

it('locks document edits and source removal during export; download failure leaves the previous result', async () => {
  await importAndInsert();
  const result = { blob: new Blob(), width: 1000, height: 1000, fingerprint: 'first' };
  vi.mocked(exportPng).mockResolvedValue(result);
  await act(async () => studio.doExport());
  expect(studio.result).toBe(result);
  let finish!: (value: typeof result) => void;
  vi.mocked(exportPng).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = studio.doExport(); });
  expect(studio.exporting).toBe(true);
  act(() => { expect(studio.commitSettings({ W: 200 })).toBe(false); studio.removeAsset(asset.id); });
  expect(studio.assets).toHaveLength(1);
  vi.mocked(downloadPng).mockImplementationOnce(() => { throw new Error('Download failed'); });
  await act(async () => { finish({ ...result, fingerprint: 'second' }); await pending; });
  expect(studio.result).toBe(result);
  expect(studio.exportError).toBe('Download failed');
  expect(studio.exporting).toBe(false);
});

it('releases assets that finish importing after unmount', async () => {
  let finish!: (value: Awaited<ReturnType<typeof importBatch>>) => void;
  vi.mocked(importBatch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = studio.onFiles([new File([], 'motif.png')]); });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => { finish({ assets: [asset], errors: [] }); await pending; });
  expect(releaseAssets).toHaveBeenCalledWith([asset]);
});

it('inspector no-op blur preserves precision, Escape cancels, and rejected values revert', async () => {
  const onTransform = vi.fn(() => false);
  const selected = { id: 'p', assetId: 'a', x: 0, y: 0, s: .123456789, deg: 0, flipX: false, flipY: false };
  await act(async () => root.render(<Inspector selected={selected} asset={asset} busy={false} onTransform={onTransform} />));
  const input = host.querySelector('input')!;
  act(() => { input.focus(); input.blur(); });
  expect(onTransform).not.toHaveBeenCalled();
  act(() => { input.focus(); input.value = '75'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(onTransform).not.toHaveBeenCalled();
  act(() => { input.focus(); input.value = '0'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(onTransform).toHaveBeenCalledWith('p', { s: 0 });
  expect(input.valueAsNumber).toBe(selected.s * 100);
});

it('proof cancels obsolete decoding, hides old pixels, and reports failure without verification', async () => {
  let finish!: () => void;
  vi.mocked(drawProof).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const result = { blob: new Blob(), width: 100, height: 100, fingerprint: 'first' };
  await act(async () => root.render(<ProofPanel result={result} fingerprint="first" />));
  const signal = vi.mocked(drawProof).mock.calls[0][2]!;
  vi.mocked(drawProof).mockRejectedValueOnce(new Error('Decode failed'));
  await act(async () => root.render(<ProofPanel result={{ ...result, blob: new Blob() }} fingerprint="edited" />));
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
  expect(host.querySelector('canvas')!.hidden).toBe(true);
  expect(host.textContent).toContain('Decode failed');
  expect(host.textContent).not.toContain('dimensions verified');
});

it('wires the real app importer, source removal, placement inspector and verified export', async () => {
  vi.mocked(drawProof).mockResolvedValue(undefined);
  vi.mocked(exportPng).mockImplementation(async doc => ({ blob: new Blob(), width: doc.W, height: doc.H, fingerprint: JSON.stringify(doc) }));
  await act(async () => root.render(<App />));
  expect(host.textContent).toContain('No source images');
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [new File([], 'motif.png')] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  const remove = () => host.querySelector<HTMLButtonElement>('[aria-label="Remove source motif"]')!;
  expect(remove().disabled).toBe(false);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Place motif"]')!.click());
  expect(remove().disabled).toBe(true);
  expect(host.querySelector('#selected-scale')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.export-panel-button')!.click());
  expect(host.textContent).toContain('Decoded PNG · dimensions verified');
  expect(downloadPng).toHaveBeenCalledOnce();
});
