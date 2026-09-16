import type { NamedAsset, Placement } from '../core/types';
import { flipLabel } from '../ui/presentation';

export function Inspector({ selected, asset, busy, onTransform }: {
  selected?: Placement; asset?: NamedAsset; busy: boolean;
  onTransform: (id: string, patch: Partial<Pick<Placement, 's' | 'deg'>>) => boolean;
}) {
  return <section className="selection-section" aria-labelledby="inspector-heading">
    <div className="section-heading"><h2 id="inspector-heading">Inspector</h2><span className="section-meta">Placement</span></div>
    {selected ? <>
      <strong className="selected-name" title={asset?.name}>{asset?.name ?? 'Source image'}</strong>
      <dl className="selection-details">
        <dt>Center X / Y</dt><dd data-testid="selected-position">{selected.x.toFixed(1)} / {selected.y.toFixed(1)}</dd>
        {(['s', 'deg'] as const).map(field => {
          const scale = field === 's', label = scale ? 'Scale (%)' : 'Rotation (°)';
          const value = selected[field] * (scale ? 100 : 1);
          return <TransformField key={`${selected.id}:${field}:${value}`} label={label} value={value} busy={busy}
            testId={scale ? 'selected-scale' : 'selected-rotation'}
            commit={value => onTransform(selected.id, { [field]: value / (scale ? 100 : 1) })} />;
        })}
        <dt>Orientation</dt><dd data-testid="selected-flips">{flipLabel(selected)}</dd>
      </dl>
      {selected.s > 1 && <p className="native-warning" data-testid="selected-upscale">Exceeds native size</p>}
      <p className="small-note">Editing any repeat copy updates this placement.</p>
    </> : <p className="small-note">Select a repeat copy or an item in Placements to inspect its transform.</p>}
  </section>;
}

function TransformField({ label, value, busy, testId, commit }: {
  label: string; value: number; busy: boolean; testId: string; commit: (value: number) => boolean;
}) {
  return <><dt><label htmlFor={testId}>{label}</label></dt><dd data-testid={testId}>
    <input id={testId} type="number" step="any" defaultValue={value} disabled={busy}
      onBlur={e => {
        const next = e.currentTarget.valueAsNumber;
        if (next !== value && !commit(next)) e.currentTarget.value = String(value);
      }} onKeyDown={e => {
        if (e.key === 'Escape') e.currentTarget.value = String(value);
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
      }} />
  </dd></>;
}
