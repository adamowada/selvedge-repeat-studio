import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { NamedAsset, Placement } from '../core/types';
import { flipLabel } from '../ui/presentation';
import { Icon } from './Icon';

interface Props {
  assets: NamedAsset[];
  placements: Placement[];
  selected: string | undefined;
  loading: boolean;
  busy: boolean;
  errors: string[];
  onFiles: (files: File[]) => void;
  onInsert: (asset: NamedAsset) => void;
  onSelect: (id: string) => void;
  onReorder: (id: string, target: string, above: boolean) => boolean;
  clearErrors: () => void;
  onRemove: (id: string) => boolean;
}
export function AssetTray({ assets, placements, selected, loading, busy, errors, onFiles, onInsert, onSelect, onReorder, clearErrors, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; above: boolean } | null>(null);
  const endDrag = () => { setDragging(null); setDrop(null); };
  useEffect(() => { if (busy) { setRemoving(null); setDragging(null); setDrop(null); } }, [busy]);
  const isAbove = (event: DragEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2;
  };
  const cancelRemoval = () => { removeButton.current?.focus(); setRemoving(null); };
  const compact = assets.length > 0;
  return <aside className="asset-sidebar" aria-label="Sources and placements">
    <section className="asset-section" aria-labelledby="sources-heading">
      <div className="section-heading"><h2 id="sources-heading">Source images</h2><span className="count">{assets.length}</span></div>
      <button className={`upload-zone ${compact ? 'compact' : ''} ${over ? 'drag-over' : ''}`} disabled={loading}
        onClick={() => input.current?.click()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.types.includes('Files')) setOver(true); }}
        onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}>
        <Icon name={compact ? 'plus' : 'upload'} size={18} />
        <strong>{loading ? 'Reading PNGs…' : compact ? 'Add PNGs' : 'Drop PNGs or browse'}</strong>
      </button>
      <input ref={input} data-testid="png-input" type="file" accept=".png,image/png" multiple hidden
        onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <p className="source-note" title="Up to 64 sources, 32 megapixels and 64 MiB of PNG files per session">Native pixels + alpha · up to 4096 px/side</p>
      <div className="source-content">
        {!!errors.length && <div className="import-errors" role="alert">
          <div className="message-heading"><Icon name="alert" size={16} /><strong>Some files were not imported</strong>
            <button className="icon-button" aria-label="Dismiss import errors" onClick={clearErrors}><Icon name="close" size={16} /></button></div>
          <div className="import-error-list">{errors.map((error, i) => <p key={i}>{error}</p>)}</div>
        </div>}
        <div className="asset-list">
          {assets.map(asset => {
            const count = placements.filter(p => p.assetId === asset.id).length;
            return <div className="asset-row" key={asset.id}><button className="asset-card" data-testid="asset-card" aria-label={`Place ${asset.name}`}
            title={`${asset.name} · ${asset.nativeW} × ${asset.nativeH} px`} disabled={busy} onClick={() => onInsert(asset)}>
            <span className="asset-thumbnail checker"><img src={asset.image.src} alt="" draggable={false} /></span>
            <span className="asset-text"><strong>{asset.name}</strong><span>{asset.nativeW} × {asset.nativeH} px</span></span>
          </button><button className="icon-button remove-source" aria-label={`Remove source ${asset.name}`} title="Remove source and its placements"
            ref={removing === asset.id ? removeButton : undefined} disabled={busy} aria-expanded={removing === asset.id}
            aria-controls={removing === asset.id ? `remove-confirm-${asset.id}` : undefined}
            onClick={() => setRemoving(removing === asset.id ? null : asset.id)}><Icon name="trash" size={16} /></button>
          {removing === asset.id && <div className="source-confirm" id={`remove-confirm-${asset.id}`} role="group" aria-label={`Confirm removal of ${asset.name}`}
            ref={node => node?.scrollIntoView?.({ block: 'nearest' })}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRemoval(); } }}>
            <p>Remove <strong>{asset.name}</strong>{count ? ` and its ${count} placement${count === 1 ? '' : 's'}` : ''}?</p>
            <p className="small-note">You can undo this. The original PNG file stays on disk.</p>
            <div className="source-confirm-actions">
              <button autoFocus className="secondary" onClick={cancelRemoval}>Cancel</button>
              <button className="confirm-remove" disabled={busy} onClick={() => { if (onRemove(asset.id)) setRemoving(null); }}>Remove</button>
            </div>
          </div>}
          </div>; })}
          {!assets.length && <div className="empty-assets"><strong>No source images</strong><p>Drop PNGs above or add the demo.</p></div>}
        </div>
      </div>
    </section>
    <section className="placement-section" aria-labelledby="placements-heading">
      <div className="section-heading"><h2 id="placements-heading">Placements</h2><span className="count">{placements.length}</span></div>
      <p className="list-caption" id="placement-help">Topmost first · drag to reorder<br />Select, then Alt + ↑ / ↓</p>
      <div className="placement-list" data-testid="placement-list">
        {[...placements].reverse().map(p => {
          const a = assets.find(a => a.id === p.assetId);
          return <button key={p.id} className={`placement-item ${selected === p.id ? 'selected' : ''} ${dragging === p.id ? 'dragging' : ''} ${drop?.id === p.id ? (drop.above ? 'drop-above' : 'drop-below') : ''}`} data-testid="placement-item"
            aria-pressed={selected === p.id} aria-describedby="placement-help" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            title={`${a?.name ?? 'Source image'} · ${flipLabel(p)} · Drag to reorder`} disabled={busy} onClick={() => onSelect(p.id)}
            draggable={!busy && placements.length > 1}
            onDragStart={e => {
              e.dataTransfer.setData('application/x-selvedge-placement', p.id); e.dataTransfer.effectAllowed = 'move';
              setDragging(p.id); e.currentTarget.focus({ preventScroll: true });
            }}
            onDragEnd={endDrag}
            onDragOver={e => {
              if (busy || !dragging || dragging === p.id) return;
              e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDrop({ id: p.id, above: isAbove(e) });
            }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}
            onDrop={e => {
              if (!dragging) return;
              e.preventDefault(); e.stopPropagation();
              if (!busy) onReorder(dragging, p.id, isAbove(e));
              endDrag();
            }}
            onKeyDown={e => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              const above = e.key === 'ArrowUp';
              const target = placements[placements.indexOf(p) + (above ? 1 : -1)];
              if (target && !busy) onReorder(p.id, target.id, above);
              e.currentTarget.scrollIntoView({ block: 'nearest' });
            }}>
            <span className="placement-thumb checker">{a && <img src={a.image.src} alt="" draggable={false} />}</span>
            <span className="placement-title"><strong>{a?.name ?? 'Source image'}</strong>
              <small>{Math.round(p.s * 100)}% · {Math.round(p.deg)}°{p.flipX || p.flipY ? ` · ${flipLabel(p)}` : ''}</small></span>
            <Icon name="grip" size={12} />
          </button>;
        })}
        {!placements.length && <p className="placement-empty">Click a source image to create a placement.</p>}
      </div>
    </section>
  </aside>;
}
