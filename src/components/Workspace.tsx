import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva/lib/ReactKonvaCore';
import type Konva from 'konva';
import '../core/konva';
import { recoverCamera, renderViewBounds, type ViewSize } from '../core/camera';
import { enumerateCopies, lattice } from '../core/geometry';
import { fitCamera, imageProps } from '../core/transforms';
import { MAX_COPIES, copyKey, type AssetMap, type Camera, type Copy, type CopyKey, type Point, type RepeatDocument } from '../core/types';
import { arrowDelta, isFormField, releaseArrow } from '../ui/keyboard';
import { CANVAS_COLORS } from '../ui/presentation';
import { Icon } from './Icon';
import { SelectionToolbar } from './SelectionToolbar';

export type EditAction = 'duplicate' | 'delete' | 'flipH' | 'flipV' | 'front' | 'back' | 'undo' | 'redo';
export type Size = ViewSize;
interface Props {
  doc: RepeatDocument; assets: AssetMap; camera: Camera; selection: CopyKey | null; pin: CopyKey | null;
  size: Size; busy: boolean; error: string | null; selectedName?: string; inspect: boolean;
  demoBusy: boolean; onDemo: () => void;
  focusRef: RefObject<HTMLDivElement | null>;
  onSize: (size: Size) => void; onZoom: (pointer: Point, factor: number) => boolean; onPan: (dx: number, dy: number) => boolean;
  onSelect: (copy: CopyKey | null) => void;
  onBegin: (copy: Copy) => boolean; onNode: (copy: Copy, node: Konva.Image) => void; onEnd: (copy?: CopyKey) => void;
  onAction: (action: EditAction) => void; onNudge: (dx: number, dy: number) => void; onNudgeEnd: () => void;
  onFit: () => void; clearError: () => void; onStage: (stage: Konva.Stage | null) => void;
}
export function Workspace(props: Props) {
  const { doc, assets, camera, selection, pin, size, busy, error, focusRef, inspect } = props;
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Image>());
  const [space, setSpace] = useState(false);
  const pan = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const heldArrows = useRef(new Set<string>());
  const latest = useRef(props);
  latest.current = props;
  const rendered = useMemo(() => {
    try {
      return { copies: enumerateCopies(doc, assets, renderViewBounds(camera, size), pin), error: null };
    } catch (error) { return { copies: [] as Copy[], error: error instanceof Error ? error.message : 'Cannot render this view.' }; }
  }, [doc, assets, camera, size, pin]);
  const placements = useMemo(() => new Map(doc.placements.map(p => [p.id, p])), [doc.placements]);
  const { a, b } = lattice(doc.W, doc.H, doc.mode);
  useLayoutEffect(() => {
    const node = selection ? nodes.current.get(copyKey(selection)) : undefined;
    const tr = transformer.current;
    if (!tr) return;
    const target = inspect ? undefined : node;
    if (tr.nodes()[0] !== target) tr.nodes(target ? [target] : []);
    tr.getLayer()?.batchDraw();
  }, [rendered.copies, selection, inspect]);
  useEffect(() => {
    const element = host.current!;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      pan.current = null;
      heldArrows.current.clear();
      latest.current.onSize({ width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) });
    });
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (latest.current.busy) return;
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      latest.current.onZoom({ x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-Math.max(-300, Math.min(300, delta)) * .002));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const blur = () => {
      setSpace(false); pan.current = null;
      stage.current?.find('.motif-copy').forEach(node => node.stopDrag());
      transformer.current?.stopTransform();
      heldArrows.current.clear();
      latest.current.onNudgeEnd(); latest.current.onEnd();
    };
    window.addEventListener('blur', blur);
    // A release outside the workspace must never leave Space-pan latched on.
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Space') { setSpace(false); pan.current = null; }
      const released = releaseArrow(heldArrows.current, e.key);
      if (released.handled && !isFormField(e.target)) e.preventDefault();
      if (released.finished) latest.current.onNudgeEnd();
    };
    window.addEventListener('keyup', keyup);
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); window.removeEventListener('blur', blur); window.removeEventListener('keyup', keyup); };
  }, []);
  useEffect(() => { props.onStage(stage.current); return () => props.onStage(null); }, [props.onStage]);
  const issue = error ?? rendered.error;
  const canRecoverWithFit = useMemo(() => {
    if (!rendered.error || busy) return false;
    try {
      recoverCamera(doc, assets, fitCamera(doc, size.width, size.height), size, pin);
      return true;
    } catch { return false; }
  }, [rendered.error, busy, doc, assets, size, pin]);
  return <section className="workspace" ref={focusRef} tabIndex={0} aria-label="Repeat workspace" data-testid="workspace"
    onKeyDown={e => {
      if (isFormField(e.target)) return;
      if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); if (!busy) setSpace(true); return; }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && (key === 'z' || key === 'd')) {
        e.preventDefault(); heldArrows.current.clear(); props.onNudgeEnd();
        if (!pin) props.onAction(key === 'd' ? 'duplicate' : e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (e.key === 'Delete' && !mod && !e.altKey) { e.preventDefault(); heldArrows.current.clear(); props.onNudgeEnd(); if (!pin) props.onAction('delete'); return; }
      const delta = !mod && !e.altKey ? arrowDelta(e.key, e.shiftKey) : null;
      if (delta) {
        e.preventDefault();
        if (!pin && selection) {
          heldArrows.current.add(e.key);
          props.onNudge(delta.x, delta.y);
        }
      }
    }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setSpace(false); pan.current = null; heldArrows.current.clear(); props.onNudgeEnd(); } }}>
    <SelectionToolbar selected={!!selection} name={props.selectedName} busy={busy}
      onAction={action => { props.onAction(action); focusRef.current?.focus({ preventScroll: true }); }} />
    <div className={`canvas-host checker ${space ? 'panning' : ''}`} ref={host} data-testid="canvas-host" onMouseDown={() => focusRef.current?.focus({ preventScroll: true })}>
      <Stage ref={stage} width={size.width} height={size.height} onMouseDown={e => { if (e.target === e.target.getStage()) props.onSelect(null); }}>
        <Layer>
          {doc.background && <Rect x={0} y={0} width={size.width} height={size.height} fill={doc.background} listening={false} />}
          <Group x={camera.x} y={camera.y} scaleX={camera.z} scaleY={camera.z} name="model-space">
            {rendered.copies.map(copy => {
              const p = placements.get(copy.id)!;
              return <KonvaImage key={copyKey(copy)} ref={node => { if (node) nodes.current.set(copyKey(copy), node); else nodes.current.delete(copyKey(copy)); }}
                {...imageProps(p, assets.get(p.assetId)!, copy)}
                id={copyKey(copy)} name="motif-copy" copyId={copy.id} copyI={copy.i} copyJ={copy.j}
                draggable={!space && (!busy || !!pin)} onMouseDown={e => { e.cancelBubble = true; props.onSelect(copy); }}
                onDragStart={e => { if (!props.onBegin(copy)) (e.target as Konva.Image).stopDrag(); }} onDragMove={e => props.onNode(copy, e.target as Konva.Image)}
                onDragEnd={e => { props.onNode(copy, e.target as Konva.Image); props.onEnd(copy); }}
                onTransformStart={() => { if (!props.onBegin(copy)) transformer.current?.stopTransform(); }} onTransform={e => props.onNode(copy, e.target as Konva.Image)}
                onTransformEnd={e => { props.onNode(copy, e.target as Konva.Image); props.onEnd(copy); }} />;
            })}
            {!inspect && <>
              <Line points={[0, 0, a.x, a.y, a.x + b.x, a.y + b.y, b.x, b.y]} closed
                stroke={CANVAS_COLORS.outline} strokeWidth={1 / camera.z} dash={[5 / camera.z, 5 / camera.z]} opacity={.72} listening={false} />
              <Text text="Origin cell" x={0} y={-19 / camera.z} fontFamily="Arial, sans-serif"
                fontSize={11 / camera.z} fill={CANVAS_COLORS.outline} listening={false} />
            </>}
            <Transformer ref={transformer} visible={!inspect && !space} listening={!busy || !!pin}
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              keepRatio flipEnabled={false} rotateEnabled rotateAnchorOffset={26}
              anchorSize={11} anchorCornerRadius={2} borderStroke={CANVAS_COLORS.accent}
              anchorStroke={CANVAS_COLORS.accent} anchorFill={CANVAS_COLORS.handle} borderStrokeWidth={1.2} padding={0}
              anchorStyleFunc={anchor => {
                anchor.cornerRadius(anchor.hasName('rotater') ? 6 : 2);
                anchor.fill(anchor.hasName('rotater') ? CANVAS_COLORS.accent : CANVAS_COLORS.handle);
              }}
              boundBoxFunc={(oldBox, newBox) => Object.values(newBox).every(Number.isFinite) && Math.abs(newBox.width) >= 1 && Math.abs(newBox.height) >= 1 ? newBox : oldBox} />
          </Group>
        </Layer>
      </Stage>
      {!doc.placements.length && <div className="canvas-empty">
        <h1>No placements yet</h1>
        <p>Add PNGs in Source images, then click an image to place it.</p>
        <button className="secondary" aria-label="Start with demo" disabled={props.demoBusy} onClick={props.onDemo}>Add demo</button>
      </div>}
      {space && <div className="pan-surface" data-testid="pan-surface"
        onPointerDown={e => {
          if (e.button !== 0 || !e.isPrimary || latest.current.busy) return;
          e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
          pan.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
        }}
        onPointerMove={e => {
          const active = pan.current;
          if (!active || active.pointerId !== e.pointerId) return;
          if (!(e.buttons & 1) || latest.current.busy) { pan.current = null; return; }
          // Apply screen deltas to the synchronous current camera in useStudio.
          // Wheel zoom, Fit or history recovery cannot be undone by a stale
          // pointer-down camera snapshot on the next move.
          if (latest.current.onPan(e.clientX - active.x, e.clientY - active.y)) {
            pan.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
          }
        }}
        onPointerUp={e => {
          if (pan.current?.pointerId === e.pointerId) pan.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={e => { if (pan.current?.pointerId === e.pointerId) pan.current = null; }}
        onLostPointerCapture={e => { if (pan.current?.pointerId === e.pointerId) pan.current = null; }} />}
      {issue && <div className="canvas-error" role="alert">
        <Icon name="alert" size={16} />
        <div className="canvas-error-body"><strong>{rendered.error ? 'View cannot be rendered' : 'Action not applied'}</strong><p>{issue}</p>
          {canRecoverWithFit && <button className="secondary" disabled={busy} onClick={props.onFit}>Fit view</button>}</div>
        {/* Active render guards remain visible until recovered; transient rejected edits can be dismissed. */}
        {!rendered.error && <button className="icon-button" aria-label="Dismiss workspace message" onClick={props.clearError}><Icon name="close" size={16} /></button>}
      </div>}
    </div>
    <div className="canvas-footer">
      <span className="workspace-hint" data-testid="workspace-hint">{space ? 'Panning · drag to move view' : selection
        ? <><span>Arrows nudge · Shift 10 px</span><span className="extra-hint"> · Ctrl/Cmd+D duplicate · Delete</span></>
        : 'Space+drag to pan · Scroll to zoom'}</span>
      <div className="view-status"><strong data-testid="zoom-value">{(camera.z * 100).toFixed(0)}%</strong>
        <span data-testid="copy-count" className={`copy-count ${rendered.copies.length >= MAX_COPIES * .9 ? 'near-limit' : ''}`}
          title={`Maximum ${MAX_COPIES.toLocaleString()} copies per render`}>{rendered.copies.length.toLocaleString()} copies</span></div>
    </div>
  </section>;
}
