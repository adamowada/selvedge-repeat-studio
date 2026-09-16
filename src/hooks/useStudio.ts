import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { navigateCamera, preflightCamera, recoverCamera } from '../core/camera';
import { activeAssets, changePlacement, cleanSelection, reorderPlacement } from '../core/document';
import { downloadPng, exportPng, type ExportResult } from '../core/export';
import { CopyLimitError, enumerateCopies, validateDocument } from '../core/geometry';
import { downloadBlob } from '../core/download';
import { decodeProject, encodeProject, projectFingerprint } from '../core/project';
import { createImportBudget, DEMO_FILES, demoFiles, importBatch, releaseAssets } from '../core/png';
import { fitCamera, imageProps, placementFromNode, screenToModel, viewportBounds, zoomAt } from '../core/transforms';
import { INITIAL_DOCUMENT, sameCopy, type DocumentSettings, type Camera, type Copy, type CopyKey, type NamedAsset, type Point, type Placement, type RepeatDocument } from '../core/types';
import type { EditAction, Size } from '../components/Workspace';
import { useHistory } from './useHistory';

export function useStudio() {
  const { history, ref: historyRef, send } = useHistory({ ...INITIAL_DOCUMENT, sourceIds: [] });
  const [storedAssets, setAssets] = useState<NamedAsset[]>([]);
  const assets = useMemo(() => activeAssets(history.present, storedAssets), [history.present, storedAssets]);
  const assetsRef = useRef<NamedAsset[]>([]);
  const importBudget = useRef(createImportBudget());
  const assetMap = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const [selection, select] = useState<CopyKey | null>(null);
  const selectionRef = useRef<CopyKey | null>(null);
  const [pin, setPin] = useState<CopyKey | null>(null);
  const pinRef = useRef<CopyKey | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, z: .2 });
  const cameraRef = useRef(camera);
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const sizeRef = useRef(size);
  const [error, setError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(0);
  const pendingImports = useRef(0);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectName, setProjectName] = useState('Untitled');
  const [savedSnapshot, setSavedSnapshot] = useState(() => projectFingerprint(INITIAL_DOCUMENT, []));
  const snapshot = useMemo(() => projectFingerprint(history.present, assets), [history.present, assets]);
  const dirty = snapshot !== savedSnapshot;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const operationRef = useRef<'export' | 'open' | 'save' | null>(null);
  const mounted = useRef(true);
  const demoIds = useRef(new Map<string, string>());
  const demoLoading = useRef(false);
  const nudgeActive = useRef(false);
  const focusRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const onStage = useCallback((stage: Konva.Stage | null) => { stageRef.current = stage; }, []);
  const currentAssets = () => new Map(assetsRef.current.map(a => [a.id, a]));
  const setSelection = useCallback((copy: CopyKey | null) => { selectionRef.current = copy; select(copy); }, []);
  const storeCamera = (next: Camera) => { cameraRef.current = next; setCamera(next); };
  const message = (e: unknown) => e instanceof Error ? e.message : 'The operation failed.';
  const checkView = (doc: RepeatDocument, nextCamera: Camera) => {
    preflightCamera(doc, currentAssets(), nextCamera, sizeRef.current, pinRef.current);
  };
  const tryCamera = (next: Camera) => {
    try {
      const navigation = navigateCamera(historyRef.current.present, currentAssets(), cameraRef.current, next, sizeRef.current, pinRef.current);
      storeCamera(navigation.camera); setError(navigation.error); return true;
    } catch (e) { setError(message(e)); return false; }
  };
  const zoom = (pointer: Point, factor: number) => tryCamera(zoomAt(cameraRef.current, pointer, factor));
  const panBy = (dx: number, dy: number) => tryCamera({
    ...cameraRef.current, x: cameraRef.current.x + dx, y: cameraRef.current.y + dy,
  });
  const recoverView = (requested: Camera, fallback = cameraRef.current) => {
    try {
      storeCamera(recoverCamera(historyRef.current.present, currentAssets(), requested, sizeRef.current, pinRef.current));
      setError(null); return true;
    } catch (e) {
      storeCamera(fallback); setError(message(e)); return false;
    }
  };
  const tryDocument = (next: RepeatDocument, preview = false) => {
    try {
      if (operationRef.current) return false;
      // An unrelated commit must not consume a live drag/resize/nudge baseline.
      if (!preview && historyRef.current.baseline !== null) return false;
      if (preview && historyRef.current.baseline === null) return false;
      next = { ...next, sourceIds: next.sourceIds ?? historyRef.current.present.sourceIds };
      validateDocument(next, currentAssets());
      checkView(next, cameraRef.current);
      send({ type: preview ? 'preview' : 'commit', value: next });
      setError(null); return true;
    } catch (e) { setError(message(e)); return false; }
  };
  const commitSettings = (patch: Partial<DocumentSettings>) =>
    tryDocument({ ...historyRef.current.present, ...patch });
  const commitTransform = (id: string, patch: Partial<Pick<Placement, 's' | 'deg'>>) =>
    tryDocument(changePlacement(historyRef.current.present, id, patch));
  const reorder = (id: string, target: string, above: boolean) =>
    tryDocument(reorderPlacement(historyRef.current.present, id, { target, above }));
  const removeAsset = (id: string) => {
    const { present: doc, baseline } = historyRef.current;
    if (operationRef.current || baseline || !doc.sourceIds?.includes(id)) return false;
    // Removing sources can only reduce scene density, so allow it even when
    // the current camera is over budget. One snapshot restores both lists.
    send({ type: 'commit', value: { ...doc, sourceIds: doc.sourceIds.filter(source => source !== id),
      placements: doc.placements.filter(p => p.assetId !== id) } });
    setSelection(cleanSelection(historyRef.current.present, selectionRef.current));
    recoverView(cameraRef.current);
    return true;
  };
  const selectCopy = (copy: CopyKey | null) => {
    if (pinRef.current || operationRef.current) return;
    endNudge();
    setSelection(copy);
  };
  const onSize = (next: Size) => {
    // Finish interrupted gestures before a resize can invalidate the copy set.
    if (pinRef.current) {
      stageRef.current?.find('.motif-copy').forEach(node => node.stopDrag());
      stageRef.current?.findOne<Konva.Transformer>('Transformer')?.stopTransform();
      end();
    }
    endNudge();
    const old = sizeRef.current;
    sizeRef.current = next; setSize(next);
    const nextCamera = old.width === 1 ? fitCamera(historyRef.current.present, next.width, next.height) : { ...cameraRef.current, x: cameraRef.current.x + (next.width - old.width) / 2, y: cameraRef.current.y + (next.height - old.height) / 2 };
    // Keep the model point at the center; zoom closer only if needed. If no
    // centered view fits, keep navigation possible without allocating copies.
    recoverView(nextCamera, nextCamera);
  };
  const fit = () => recoverView(fitCamera(historyRef.current.present, sizeRef.current.width, sizeRef.current.height));
  const addAssets = (added: NamedAsset[]) => {
    if (!mounted.current) { releaseAssets(added); return; }
    if (!added.length) return;
    assetsRef.current = [...assetsRef.current, ...added];
    setAssets(assetsRef.current);
    // Imports remain outside undo history, including a pending gesture. Only
    // explicit removal changes visibility as an undoable edit.
    send({ type: 'map', update: doc => ({ ...doc, sourceIds: [...(doc.sourceIds ?? []), ...added.map(a => a.id)] }) });
  };
  const onFiles = async (files: File[]) => {
    if (!files.length || operationRef.current === 'open' || operationRef.current === 'save') return;
    pendingImports.current++;
    setLoading(n => n + 1);
    try {
      const imported = await importBatch(files, importBudget.current);
      addAssets(imported.assets);
      if (mounted.current) setImportErrors(errors => [...errors, ...imported.errors]);
    } catch (e) { if (mounted.current) setImportErrors(errors => [...errors, message(e)]); }
    finally { pendingImports.current--; if (mounted.current) setLoading(n => n - 1); }
  };
  const insert = (asset: NamedAsset) => {
    if (historyRef.current.baseline || operationRef.current || !historyRef.current.present.sourceIds?.includes(asset.id)) return;
    const doc = historyRef.current.present;
    const viewport = sizeRef.current;
    const center = screenToModel({ x: viewport.width / 2, y: viewport.height / 2 }, cameraRef.current);
    const p: Placement = { id: crypto.randomUUID(), assetId: asset.id, ...center,
      s: Math.min(1, doc.W * .48 / asset.nativeW, doc.H * .48 / asset.nativeH, viewport.width / cameraRef.current.z * .48 / asset.nativeW, viewport.height / cameraRef.current.z * .48 / asset.nativeH), deg: 0, flipX: false, flipY: false };
    if (tryDocument({ ...doc, placements: [...doc.placements, p] })) setSelection({ id: p.id, i: 0, j: 0 });
    focusRef.current?.focus();
  };
  const addDemo = async () => {
    if (demoLoading.current || historyRef.current.baseline || operationRef.current) return;
    demoLoading.current = true; setLoading(n => n + 1);
    try {
      const missing = DEMO_FILES.filter(name => !demoIds.current.has(name));
      if (missing.length) {
        const imported = await importBatch(await demoFiles(missing), importBudget.current);
        addAssets(imported.assets);
        for (const asset of imported.assets) demoIds.current.set(`${asset.name}.png`, asset.id);
        if (mounted.current) setImportErrors(errors => [...errors, ...imported.errors]);
      }
      if (!mounted.current) return;
      // Loading does not lock editing. Recheck after the async boundary, before
      // insertion, selection, Fit or focus can interrupt a newer operation.
      if (historyRef.current.baseline !== null || operationRef.current) {
        setError('Demo images are ready in Source images. Finish the current edit or export, then click Demo to place them.');
        return;
      }
      const doc = historyRef.current.present;
      const positions = [[.25, .28, -12], [.73, .58, 24], [.32, .80, -18]];
      const added = DEMO_FILES.flatMap((name, i): Placement[] => {
        const id = demoIds.current.get(name);
        if (!id) return [];
        const a = assetsRef.current.find(a => a.id === id)!;
        return [{ id: crypto.randomUUID(), assetId: id, x: positions[i][0] * doc.W, y: positions[i][1] * doc.H,
          s: Math.min(1, doc.W * .4 / a.nativeW, doc.H * .4 / a.nativeH), deg: positions[i][2], flipX: false, flipY: false }];
      });
      const sourceIds = [...new Set([...(doc.sourceIds ?? []), ...added.map(p => p.assetId)])];
      if (tryDocument({ ...doc, sourceIds, placements: [...doc.placements, ...added] })) { setSelection(null); fit(); }
      focusRef.current?.focus();
    } catch (e) { if (mounted.current) setImportErrors(errors => [...errors, message(e)]); }
    finally { demoLoading.current = false; if (mounted.current) setLoading(n => n - 1); }
  };
  const selectPlacement = (id: string) => {
    if (historyRef.current.baseline || operationRef.current) return;
    const doc = historyRef.current.present;
    const p = doc.placements.find(p => p.id === id);
    if (!p) return;
    let copies: Copy[] = [];
    try { copies = enumerateCopies(doc, currentAssets(), viewportBounds(cameraRef.current, sizeRef.current.width, sizeRef.current.height)).filter(c => c.id === id); } catch { /* Recover by centering below. */ }
    const center = screenToModel({ x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }, cameraRef.current);
    copies.sort((a, b) => Math.hypot(p.x + a.tx - center.x, p.y + a.ty - center.y) - Math.hypot(p.x + b.tx - center.x, p.y + b.ty - center.y));
    if (copies.length) setSelection(copies[0]);
    else {
      if (recoverView({ ...cameraRef.current, x: sizeRef.current.width / 2 - p.x * cameraRef.current.z, y: sizeRef.current.height / 2 - p.y * cameraRef.current.z })) setSelection({ id, i: 0, j: 0 });
    }
    focusRef.current?.focus();
  };
  const begin = (copy: Copy) => {
    if (operationRef.current) return false;
    if (pinRef.current) return sameCopy(pinRef.current, copy);
    endNudge();
    pinRef.current = copy; setPin(copy); setSelection(copy);
    send({ type: 'begin' });
    return true;
  };
  const onNode = (copy: Copy, node: Konva.Image) => {
    if (!pinRef.current || !sameCopy(pinRef.current, copy) || !historyRef.current.baseline) return;
    const doc = historyRef.current.present;
    const p = doc.placements.find(p => p.id === copy.id);
    if (!p) return;
    const next = placementFromNode(p, copy, { x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() });
    if (!tryDocument(changePlacement(doc, p.id, next), true)) node.setAttrs(imageProps(p, currentAssets().get(p.assetId)!, copy));
  };
  const end = (copy?: CopyKey) => {
    if (!pinRef.current || (copy && !sameCopy(pinRef.current, copy))) return;
    send({ type: 'end' });
    pinRef.current = null; setPin(null);
  };
  function endNudge() { if (nudgeActive.current) { send({ type: 'end' }); nudgeActive.current = false; } }
  const nudge = (dx: number, dy: number) => {
    if (pinRef.current || operationRef.current) return;
    const doc = historyRef.current.present;
    const p = doc.placements.find(p => p.id === selectionRef.current?.id);
    if (!p) return;
    if (!nudgeActive.current) { send({ type: 'begin' }); nudgeActive.current = true; }
    tryDocument(changePlacement(doc, p.id, { x: p.x + dx, y: p.y + dy }), true);
  };
  const action = (action: EditAction) => {
    if (pinRef.current || operationRef.current) return;
    endNudge();
    if (action === 'undo' || action === 'redo') {
      send({ type: action });
      // send updates historyRef synchronously. Recover against the restored
      // document, not this render's snapshot; camera never enters history.
      recoverView(cameraRef.current);
      return;
    }
    const doc = historyRef.current.present;
    const selected = selectionRef.current;
    const p = doc.placements.find(p => p.id === selected?.id);
    if (!p || !selected) return;
    if (action === 'duplicate') {
      const duplicated = { ...p, id: crypto.randomUUID(), x: p.x + 24, y: p.y + 24 };
      if (tryDocument({ ...doc, placements: [...doc.placements, duplicated] })) setSelection({ ...selected, id: duplicated.id });
    } else if (action === 'delete') {
      if (tryDocument({ ...doc, placements: doc.placements.filter(x => x.id !== p.id) })) setSelection(null);
    } else if (action === 'flipH' || action === 'flipV') {
      tryDocument(changePlacement(doc, p.id, action === 'flipH' ? { flipX: !p.flipX } : { flipY: !p.flipY }));
    } else { tryDocument(reorderPlacement(doc, p.id, action)); }
  };
  const doExport = async () => {
    if (operationRef.current || historyRef.current.baseline) return;
    operationRef.current = 'export'; setExporting(true); setExportError(null);
    try {
      const exported = await exportPng(historyRef.current.present, currentAssets());
      if (mounted.current) {
        // Publish the new proof only after download initiation succeeds. A
        // thrown download error must leave the previous export clearly stale.
        downloadPng(exported);
        setResult(exported);
      }
    } catch (e) { if (mounted.current) setExportError(message(e)); }
    finally { operationRef.current = null; if (mounted.current) setExporting(false); }
  };
  const canStartProject = () => !operationRef.current && !pendingImports.current && !demoLoading.current && !historyRef.current.baseline;
  const saveProject = async () => {
    if (!canStartProject()) return;
    operationRef.current = 'save'; setProjectBusy(true); setError(null);
    const doc = historyRef.current.present, sources = assetsRef.current;
    try {
      const blob = await encodeProject(doc, sources);
      if (mounted.current) {
        downloadBlob(blob, `${projectName}.selvedge`);
        setSavedSnapshot(projectFingerprint(doc, sources));
      }
    } catch (e) { if (mounted.current) setError(`Could not save project: ${message(e)}`); }
    finally { operationRef.current = null; if (mounted.current) setProjectBusy(false); }
  };
  const openProject = async (file: File) => {
    if (!canStartProject()) return;
    if (projectFingerprint(historyRef.current.present, assetsRef.current) !== savedSnapshot &&
      !window.confirm('Open this project and discard unsaved changes? Save your current project first if you want to keep it.')) return;
    operationRef.current = 'open'; setProjectBusy(true); setError(null);
    let opened: Awaited<ReturnType<typeof decodeProject>> | undefined;
    try {
      opened = await decodeProject(file);
      if (!mounted.current) return;
      const { doc, assets: sources, budget } = opened;
      let nextCamera = fitCamera(doc, sizeRef.current.width, sizeRef.current.height), viewError: string | null = null;
      try { nextCamera = recoverCamera(doc, new Map(sources.map(a => [a.id, a])), nextCamera, sizeRef.current); }
      catch (e) { if (!(e instanceof CopyLimitError)) throw e; viewError = message(e); }
      // Ownership changes only after every source and document have validated.
      const previous = assetsRef.current;
      assetsRef.current = sources; importBudget.current = budget; setAssets(sources);
      send({ type: 'reset', value: { ...doc, sourceIds: sources.map(a => a.id) } }); setSelection(null); storeCamera(nextCamera);
      demoIds.current.clear(); setImportErrors([]); setExportError(null); setResult(null); setError(viewError);
      setProjectName(file.name.replace(/\.selvedge$/i, '') || 'Untitled');
      setSavedSnapshot(projectFingerprint(doc, sources));
      opened = undefined;
      releaseAssets(previous);
    } catch (e) { if (mounted.current) setError(`Could not open project: ${message(e)}`); }
    finally {
      if (opened) releaseAssets(opened.assets);
      operationRef.current = null; if (mounted.current) setProjectBusy(false);
    }
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const valid = cleanSelection(history.present, selectionRef.current);
    if (valid !== selectionRef.current) setSelection(valid);
  }, [history.present, setSelection]);
  useEffect(() => {
    if (demoLoading.current) return;
    const h = historyRef.current;
    const retained = new Set([...h.past, h.present, ...h.future, ...(h.baseline ? [h.baseline] : [])].flatMap(doc => doc.sourceIds ?? []));
    const expired = assetsRef.current.filter(asset => !retained.has(asset.id));
    if (!expired.length) return;
    releaseAssets(expired);
    assetsRef.current = assetsRef.current.filter(asset => retained.has(asset.id));
    for (const [name, id] of demoIds.current) if (!retained.has(id)) demoIds.current.delete(name);
    setAssets(assetsRef.current);
  }, [history, storedAssets, historyRef, loading]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; releaseAssets(assetsRef.current); };
  }, []);
  return { history, historyRef, assets, assetsRef, assetMap, selection, setSelection, pin, camera, size, error, setError, importErrors, setImportErrors, loading, exporting, exportError, result, focusRef, stageRef, projectBusy, projectName, dirty, saveProject, openProject,
    tryDocument, commitSettings, commitTransform, reorder, removeAsset, selectCopy, tryCamera, zoom, panBy, onSize, fit, onFiles, insert, addDemo, selectPlacement, begin, onNode, end, nudge, endNudge, action, doExport, onStage };
}
export type Studio = ReturnType<typeof useStudio>;
