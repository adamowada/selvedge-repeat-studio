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
import { decodeProject, encodeProject } from '../src/core/project';
import { downloadBlob } from '../src/core/download';
import { INITIAL_DOCUMENT } from '../src/core/types';
import type { NamedAsset } from '../src/core/types';

vi.mock('../src/core/png', async original => ({ ...await original<object>(), importBatch: vi.fn(), releaseAssets: vi.fn() }));
vi.mock('../src/core/export', () => ({ exportPng: vi.fn(), downloadPng: vi.fn(), documentFingerprint: JSON.stringify }));
vi.mock('../src/core/proof', () => ({ drawProof: vi.fn() }));
vi.mock('../src/core/project', async original => ({ ...await original<object>(), decodeProject: vi.fn(), encodeProject: vi.fn() }));
vi.mock('../src/core/download', () => ({ downloadBlob: vi.fn() }));
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

it('removes a source and all its placements in one undo step, retaining bytes until history expires', async () => {
  await importAndInsert();
  act(() => studio.action('duplicate'));
  const before = studio.history.present, past = studio.history.past.length;
  act(() => { expect(studio.removeAsset(asset.id)).toBe(true); });
  expect(studio.assets).toHaveLength(0); expect(studio.history.present.placements).toHaveLength(0);
  expect(studio.selection).toBeNull(); expect(studio.history.past).toHaveLength(past + 1);
  expect(studio.assetsRef.current).toEqual([asset]); expect(releaseAssets).not.toHaveBeenCalled();
  act(() => studio.action('undo'));
  expect(studio.history.present).toEqual(before); expect(studio.assets).toEqual([asset]);
  act(() => studio.action('redo'));
  expect(studio.assets).toHaveLength(0);
  act(() => { for (let i = 0; i < 49; i++) studio.commitSettings({ W: 500 + i }); });
  expect(studio.history.past).toHaveLength(50);
  expect(studio.assetsRef.current).toEqual([asset]); expect(releaseAssets).not.toHaveBeenCalled();
  // Deletion is still the oldest of the 50 undoable actions.
  act(() => { for (let i = 0; i < 50; i++) studio.action('undo'); });
  expect(studio.history.present).toEqual(before); expect(studio.assets).toEqual([asset]);
  act(() => { for (let i = 0; i < 50; i++) studio.action('redo'); });
  expect(studio.assets).toHaveLength(0); expect(releaseAssets).not.toHaveBeenCalled();
  // No-op and rejected edits must not evict the last restoring snapshot.
  act(() => { studio.commitSettings({ W: 548 }); studio.commitSettings({ W: 0 }); });
  expect(studio.assetsRef.current).toEqual([asset]); expect(releaseAssets).not.toHaveBeenCalled();
  act(() => { expect(studio.commitSettings({ W: 549 })).toBe(true); });
  expect(studio.assetsRef.current).toHaveLength(0);
  expect(releaseAssets).toHaveBeenCalledExactlyOnceWith([asset]);
  act(() => { for (let i = 0; i < 50; i++) studio.action('undo'); });
  expect(studio.assets).toHaveLength(0); expect(studio.history.present.placements).toHaveLength(0);
  act(() => { for (let i = 0; i < 50; i++) studio.action('redo'); });
  expect(releaseAssets).toHaveBeenCalledExactlyOnceWith([asset]);
});

it('retains a source referenced only by redo and releases it when a new edit discards redo', async () => {
  await importAndInsert();
  const original = studio.history.present;
  act(() => studio.removeAsset(asset.id));
  act(() => { for (let i = 0; i < 49; i++) studio.commitSettings({ W: 500 + i }); });
  // Reusing a hidden source (as Demo does) evicts its last older snapshot.
  act(() => { expect(studio.tryDocument({ ...original, W: 548 })).toBe(true); });
  act(() => studio.action('undo'));
  expect(studio.history.past.every(doc => !doc.sourceIds?.includes(asset.id))).toBe(true);
  expect(studio.assets).toHaveLength(0); expect(studio.assetsRef.current).toEqual([asset]);
  expect(studio.history.future[0].sourceIds).toContain(asset.id);
  expect(releaseAssets).not.toHaveBeenCalled();
  act(() => studio.action('redo'));
  expect(studio.assets).toEqual([asset]); expect(studio.history.present.placements).toEqual(original.placements);
  act(() => studio.action('undo'));
  act(() => studio.commitSettings({ H: 501 }));
  expect(studio.history.future).toHaveLength(0); expect(studio.assetsRef.current).toHaveLength(0);
  expect(releaseAssets).toHaveBeenCalledExactlyOnceWith([asset]);
});

it('never expires an active source, even when it has no placements and history rolls over', async () => {
  await act(async () => studio.onFiles([new File([], 'motif.png')]));
  act(() => { for (let i = 0; i < 51; i++) studio.commitSettings({ W: 500 + i }); });
  expect(studio.assets).toEqual([asset]); expect(studio.assetsRef.current).toEqual([asset]);
  expect(releaseAssets).not.toHaveBeenCalled();
});

it('unused source removal is undoable and a later import does not resurrect it or consume a gesture', async () => {
  await act(async () => studio.onFiles([new File([], 'motif.png')]));
  act(() => studio.removeAsset(asset.id));
  expect(studio.assets).toHaveLength(0);
  const other = { ...asset, id: 'other' };
  vi.mocked(importBatch).mockResolvedValueOnce({ assets: [other], errors: [] });
  await act(async () => studio.onFiles([new File([], 'other.png')]));
  expect(studio.assets).toEqual([other]);
  act(() => studio.action('undo'));
  expect(studio.assets).toEqual([asset, other]);
  act(() => studio.insert(other));
  act(() => studio.nudge(1, 0));
  const baseline = studio.history.baseline!;
  const third = { ...asset, id: 'third' };
  vi.mocked(importBatch).mockResolvedValueOnce({ assets: [third], errors: [] });
  await act(async () => studio.onFiles([new File([], 'third.png')]));
  expect(studio.history.baseline!.placements).toEqual(baseline.placements);
  act(() => studio.endNudge());
  act(() => studio.action('undo'));
  expect(studio.history.present.placements).toEqual(baseline.placements);
  expect(studio.assets).toEqual([asset, other, third]);
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
  const input = host.querySelector<HTMLInputElement>('[data-testid="png-input"]')!;
  Object.defineProperty(input, 'files', { value: [new File([], 'motif.png')] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  const remove = () => host.querySelector<HTMLButtonElement>('[aria-label="Remove source motif"]')!;
  expect(remove().disabled).toBe(false);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Place motif"]')!.click());
  expect(remove().disabled).toBe(false);
  expect(host.querySelector('#selected-scale')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.export-panel-button')!.click());
  expect(host.textContent).toContain('Decoded PNG · dimensions verified');
  expect(downloadPng).toHaveBeenCalledOnce();
});

it('project save/open tracks unsaved work, confirms replacement, locks edits and resets history only on success', async () => {
  await importAndInsert();
  expect(studio.dirty).toBe(true);
  vi.mocked(encodeProject).mockResolvedValueOnce(new Blob());
  await act(async () => studio.saveProject());
  expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Untitled.selvedge');
  expect(studio.dirty).toBe(false);
  act(() => studio.commitSettings({ W: 900 }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () => studio.openProject(new File([], 'next.selvedge')));
  expect(confirm).toHaveBeenCalledOnce(); expect(decodeProject).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  let finish!: (value: Awaited<ReturnType<typeof decodeProject>>) => void;
  vi.mocked(decodeProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = studio.openProject(new File([], 'next.selvedge')); });
  expect(studio.projectBusy).toBe(true);
  act(() => { expect(studio.commitSettings({ W: 700 })).toBe(false); studio.action('delete'); studio.removeAsset(asset.id); });
  const importCount = vi.mocked(importBatch).mock.calls.length;
  await act(async () => studio.onFiles([new File([], 'late.png')]));
  expect(importBatch).toHaveBeenCalledTimes(importCount);
  expect(studio.assets).toEqual([asset]);
  const doc = { ...INITIAL_DOCUMENT, W: 420, background: null };
  const sources = [{ ...asset, id: 'new' }];
  await act(async () => { finish({ doc, assets: sources, budget: { count: 1, pixels: 64, bytes: 24 } }); await pending; });
  expect(studio.history).toEqual({ past: [], present: { ...doc, sourceIds: ['new'] }, future: [], baseline: null });
  expect(studio.assets).toEqual(sources); expect(releaseAssets).toHaveBeenCalledWith([asset]);
  expect(studio.selection).toBeNull(); expect(studio.result).toBeNull();
  expect(studio.projectName).toBe('next'); expect(studio.dirty).toBe(false); expect(studio.projectBusy).toBe(false);
});

it('failed project operations preserve the session and late project decoding releases sources after unmount', async () => {
  await importAndInsert();
  const before = studio.history, selected = studio.selection;
  vi.mocked(encodeProject).mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => studio.saveProject());
  expect(studio.dirty).toBe(true); expect(downloadBlob).not.toHaveBeenCalled();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(decodeProject).mockRejectedValueOnce(new Error('Bad project'));
  await act(async () => studio.openProject(new File([], 'broken.selvedge')));
  expect(studio.history).toBe(before); expect(studio.selection).toBe(selected);
  expect(studio.assets).toEqual([asset]); expect(studio.error).toContain('Bad project');
  expect(studio.projectBusy).toBe(false); expect(releaseAssets).not.toHaveBeenCalled();
  let finish!: (value: Awaited<ReturnType<typeof decodeProject>>) => void;
  vi.mocked(decodeProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = studio.openProject(new File([], 'late.selvedge')); });
  await act(async () => root.unmount()); root = createRoot(host);
  const sources = [{ ...asset, id: 'late' }];
  await act(async () => { finish({ doc: INITIAL_DOCUMENT, assets: sources, budget: { count: 1, pixels: 64, bytes: 24 } }); await pending; });
  expect(releaseAssets).toHaveBeenCalledWith(sources);
});
