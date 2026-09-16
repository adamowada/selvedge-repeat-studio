import { useRef, useState } from 'react';
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
  clearErrors: () => void;
}
export function AssetTray({ assets, placements, selected, loading, busy, errors, onFiles, onInsert, onSelect, clearErrors }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
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
      <p className="source-note">Native pixels + alpha · up to 4096 px/side</p>
      <div className="source-content">
        {!!errors.length && <div className="import-errors" role="alert">
          <div className="message-heading"><Icon name="alert" size={16} /><strong>Some files were not imported</strong>
            <button className="icon-button" aria-label="Dismiss import errors" onClick={clearErrors}><Icon name="close" size={16} /></button></div>
          <div className="import-error-list">{errors.map((error, i) => <p key={i}>{error}</p>)}</div>
        </div>}
        <div className="asset-list">
          {assets.map(asset => <button key={asset.id} className="asset-card" data-testid="asset-card" aria-label={`Place ${asset.name}`}
            title={`${asset.name} · ${asset.nativeW} × ${asset.nativeH} px`} disabled={busy} onClick={() => onInsert(asset)}>
            <span className="asset-thumbnail checker"><img src={asset.image.src} alt="" draggable={false} /></span>
            <span className="asset-text"><strong>{asset.name}</strong><span>{asset.nativeW} × {asset.nativeH} px</span></span>
            <span className="asset-place" aria-hidden="true"><Icon name="plus" size={16} /></span>
          </button>)}
          {!assets.length && <div className="empty-assets"><strong>No source images</strong><p>Drop PNGs above or add the demo.</p></div>}
        </div>
      </div>
    </section>
    <section className="placement-section" aria-labelledby="placements-heading">
      <div className="section-heading"><h2 id="placements-heading">Placements</h2><span className="count">{placements.length}</span></div>
      <p className="list-caption">Topmost first · select obscured items here</p>
      <div className="placement-list" data-testid="placement-list">
        {[...placements].reverse().map(p => {
          const a = assets.find(a => a.id === p.assetId);
          return <button key={p.id} className={`placement-item ${selected === p.id ? 'selected' : ''}`} data-testid="placement-item"
            aria-pressed={selected === p.id} title={`${a?.name ?? 'Source image'} · ${flipLabel(p)}`} disabled={busy} onClick={() => onSelect(p.id)}>
            <span className="placement-thumb checker">{a && <img src={a.image.src} alt="" draggable={false} />}</span>
            <span className="placement-title"><strong>{a?.name ?? 'Source image'}</strong>
              <small>{Math.round(p.s * 100)}% · {Math.round(p.deg)}°{p.flipX || p.flipY ? ` · ${flipLabel(p)}` : ''}</small></span>
          </button>;
        })}
        {!placements.length && <p className="placement-empty">Click a source image to create a placement.</p>}
      </div>
    </section>
  </aside>;
}
