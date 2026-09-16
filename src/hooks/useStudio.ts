import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { navigateCamera, preflightCamera, recoverCamera } from '../core/camera';
import { changePlacement, cleanSelection, reorderPlacement } from '../core/document';
import { downloadPng, exportPng, type ExportResult } from '../core/export';
import { enumerateCopies, outputSize, padBounds, preflightCopies, validateDocument } from '../core/geometry';
import { demoFiles, importBatch, releaseAssets } from '../core/png';
import { fitCamera, imageProps, placementFromNode, screenToModel, viewportBounds, zoomAt } from '../core/transforms';
import { INITIAL_DOCUMENT, sameCopy, type DocumentSettings, type Camera, type Copy, type CopyKey, type NamedAsset, type Point, type Placement, type RepeatDocument } from '../core/types';
import type { EditAction, Size } from '../components/Workspace';
import { useHistory } from './useHistory';

export function useStudio() {
  const { history, ref: historyRef, send } = useHistory(INITIAL_DOCUMENT);
  const [assets, setAssets] = useState<NamedAsset[]>([]);
  const assetsRef = useRef<NamedAsset[]>([]);
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const exportingRef = useRef(false);
  const mounted = useRef(true);
  const demoIds = useRef<string[]>([]);
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
      if (exportingRef.current) return false;
      // An unrelated commit must not consume a live drag/resize/nudge baseline.
      if (!preview && historyRef.current.baseline !== null) return false;
      if (preview && historyRef.current.baseline === null) return false;
      validateDocument(next, currentAssets());
      checkView(next, cameraRef.current);
      send({ type: preview ? 'preview' : 'commit', value: next });
      setError(null); return true;
    } catch (e) { setError(message(e)); return false; }
  };
  const commitSettings = (patch: Partial<DocumentSettings>) =>
    tryDocument({ ...historyRef.current.present, ...patch });
  const selectCopy = (copy: CopyKey | null) => {
    if (pinRef.current || exportingRef.current) return;
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
    assetsRef.current = [...assetsRef.current, ...added];
    setAssets(assetsRef.current);
  };
  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setLoading(n => n + 1);
    try {
      const imported = await importBatch(files);
      addAssets(imported.assets);
      if (mounted.current) setImportErrors(errors => [...errors, ...imported.errors]);
    } catch (e) { if (mounted.current) setImportErrors(errors => [...errors, message(e)]); }
    finally { if (mounted.current) setLoading(n => n - 1); }
  };
  const insert = (asset: NamedAsset) => {
    if (historyRef.current.baseline || exportingRef.current) return;
    const doc = historyRef.current.present;
    const viewport = sizeRef.current;
    const center = screenToModel({ x: viewport.width / 2, y: viewport.height / 2 }, cameraRef.current);
    const p: Placement = { id: crypto.randomUUID(), assetId: asset.id, ...center,
      s: Math.min(1, doc.W * .48 / asset.nativeW, doc.H * .48 / asset.nativeH, viewport.width / cameraRef.current.z * .48 / asset.nativeW, viewport.height / cameraRef.current.z * .48 / asset.nativeH), deg: 0, flipX: false, flipY: false };
    if (tryDocument({ ...doc, placements: [...doc.placements, p] })) setSelection({ id: p.id, i: 0, j: 0 });
    focusRef.current?.focus();
  };
  const addDemo = async () => {
    if (demoLoading.current || historyRef.current.baseline || exportingRef.current) return;
    demoLoading.current = true; setLoading(n => n + 1);
    try {
      if (!demoIds.current.length) {
        const imported = await importBatch(await demoFiles());
        addAssets(imported.assets);
        demoIds.current = imported.assets.map(a => a.id);
        if (mounted.current) setImportErrors(errors => [...errors, ...imported.errors]);
      }
      if (!mounted.current) return;
      // Loading does not lock editing. Recheck after the async boundary, before
      // insertion, selection, Fit or focus can interrupt a newer operation.
      if (historyRef.current.baseline !== null || exportingRef.current) {
        setError('Demo images are ready in Source images. Finish the current edit or export, then click Demo to place them.');
        return;
      }
      const doc = historyRef.current.present;
      const positions = [[.25, .28, -12], [.73, .58, 24], [.32, .80, -18]];
      const added = demoIds.current.map((id, i): Placement => {
        const a = assetsRef.current.find(a => a.id === id)!;
        return { id: crypto.randomUUID(), assetId: id, x: positions[i][0] * doc.W, y: positions[i][1] * doc.H,
          s: Math.min(1, doc.W * .4 / a.nativeW, doc.H * .4 / a.nativeH), deg: positions[i][2], flipX: false, flipY: false };
      });
      if (tryDocument({ ...doc, placements: [...doc.placements, ...added] })) { setSelection(null); fit(); }
      focusRef.current?.focus();
    } catch (e) { if (mounted.current) setImportErrors(errors => [...errors, message(e)]); }
    finally { demoLoading.current = false; if (mounted.current) setLoading(n => n - 1); }
  };
  const selectPlacement = (id: string) => {
    if (historyRef.current.baseline || exportingRef.current) return;
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
    if (exportingRef.current) return false;
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
    if (pinRef.current || exportingRef.current) return;
    const doc = historyRef.current.present;
    const p = doc.placements.find(p => p.id === selectionRef.current?.id);
    if (!p) return;
    if (!nudgeActive.current) { send({ type: 'begin' }); nudgeActive.current = true; }
    tryDocument(changePlacement(doc, p.id, { x: p.x + dx, y: p.y + dy }), true);
  };
  const action = (action: EditAction) => {
    if (pinRef.current || exportingRef.current) return;
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
    if (exportingRef.current || historyRef.current.baseline) return;
    exportingRef.current = true; setExporting(true); setExportError(null);
    try {
      const exported = await exportPng(historyRef.current.present, currentAssets());
      if (mounted.current) {
        // Publish the new proof only after download initiation succeeds. A
        // thrown download error must leave the previous export clearly stale.
        downloadPng(exported);
        setResult(exported);
      }
    } catch (e) { if (mounted.current) setExportError(message(e)); }
    finally { exportingRef.current = false; if (mounted.current) setExporting(false); }
  };
  useEffect(() => {
    const valid = cleanSelection(history.present, selectionRef.current);
    if (valid !== selectionRef.current) setSelection(valid);
  }, [history.present, setSelection]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; releaseAssets(assetsRef.current); };
  }, []);
  const exportCount = (() => {
    try {
      const { width, height } = outputSize(history.present);
      return preflightCopies(history.present, assetMap, padBounds({ left: 0, top: 0, right: width, bottom: height }, 1)).count;
    } catch { return null; }
  })();
  return { history, historyRef, assets, assetsRef, assetMap, selection, setSelection, pin, camera, size, error, setError, importErrors, setImportErrors, loading, exporting, exportError, result, exportCount, focusRef, stageRef,
    tryDocument, commitSettings, selectCopy, tryCamera, zoom, panBy, onSize, fit, onFiles, insert, addDemo, selectPlacement, begin, onNode, end, nudge, endNudge, action, doExport, onStage };
}
export type Studio = ReturnType<typeof useStudio>;
