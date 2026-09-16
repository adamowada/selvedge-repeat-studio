import type { NamedAsset, Placement } from '../core/types';
import { flipLabel } from '../ui/presentation';

export function Inspector({ selected, asset }: { selected?: Placement; asset?: NamedAsset }) {
  return <section className="selection-section" aria-labelledby="inspector-heading">
    <div className="section-heading"><h2 id="inspector-heading">Inspector</h2><span className="section-meta">Placement</span></div>
    {selected ? <>
      <strong className="selected-name" title={asset?.name}>{asset?.name ?? 'Source image'}</strong>
      <dl className="selection-details">
        <dt>Center X / Y</dt><dd data-testid="selected-position">{selected.x.toFixed(1)} / {selected.y.toFixed(1)}</dd>
        <dt>Scale</dt><dd data-testid="selected-scale">{(selected.s * 100).toFixed(1)}%</dd>
        <dt>Rotation</dt><dd data-testid="selected-rotation">{selected.deg.toFixed(1)}°</dd>
        <dt>Orientation</dt><dd data-testid="selected-flips">{flipLabel(selected)}</dd>
      </dl>
      {selected.s > 1 && <p className="native-warning" data-testid="selected-upscale">Exceeds native size</p>}
      <p className="small-note">Editing any repeat copy updates this placement.</p>
    </> : <p className="small-note">Select a repeat copy or an item in Placements to inspect its transform.</p>}
  </section>;
}
