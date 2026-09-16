import { documentFingerprint, type ExportResult } from '../core/export';
import { outputSize } from '../core/geometry';
import type { NamedAsset, Placement, RepeatDocument } from '../core/types';
import { MODE_LABELS } from '../ui/presentation';
import { Icon } from './Icon';
import { Inspector } from './Inspector';
import { ProofPanel } from './ProofPanel';

interface Props {
  doc: RepeatDocument; selected?: Placement; asset?: NamedAsset; result: ExportResult | null;
  busy: boolean; exporting: boolean; error: string | null; onExport: () => void;
}
export function OutputPanel({ doc, selected, asset, result, busy, exporting, error, onExport }: Props) {
  const { width, height } = outputSize(doc);
  const upscaled = doc.placements.filter(p => p.s > 1).length;
  return <aside className="output-sidebar" aria-label="Inspector and export">
    <Inspector selected={selected} asset={asset} />
    <section className="output-section" aria-labelledby="export-heading">
      <div className="section-heading"><h2 id="export-heading">Export</h2><span className="section-meta">PNG</span></div>
      <div className="output-summary">
        <svg className="tile-diagram" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <rect x="2" y={doc.mode === 'half-drop' ? 10 : 2} width={doc.mode === 'brick' ? 18 : 36} height={doc.mode === 'half-drop' ? 18 : 36} />
          {doc.mode === 'half-drop' && <path d="M20 10v18" />}
          {doc.mode === 'brick' && <path d="M2 20h18" />}
        </svg>
        <div className="output-size" data-testid="output-size">{width.toLocaleString()} <span>×</span> {height.toLocaleString()}<small>px · rectangular tile</small></div>
      </div>
      <dl className="output-specs">
        <dt>Repeat</dt><dd>{MODE_LABELS[doc.mode]}</dd>
        <dt>Layout</dt><dd>{doc.mode === 'straight' ? '1W × 1H' : doc.mode === 'half-drop' ? '2W × 1H' : '1W × 2H'}</dd>
        <dt>Background</dt><dd>{doc.background ? doc.background.toUpperCase() : 'Transparent'}</dd>
      </dl>
      <p className="export-note">Use Basic/Straight repeat elsewhere; staggering is baked in.</p>
      {!!upscaled && <p className="warning" role="status"><Icon name="alert" size={16} /><span>{upscaled} placement{upscaled > 1 ? 's exceed' : ' exceeds'} native size.</span></p>}
      <button className="primary export-panel-button" disabled={busy} aria-busy={exporting} onClick={onExport}>
        <span>{exporting ? 'Rendering PNG…' : 'Export PNG'}</span>{!exporting && <Icon name="arrow" size={16} />}
      </button>
      {error && <p className="error-text" role="alert">{error}</p>}
      <p className="pixel-note">PNG · pixels only · no DPI/CMYK settings</p>
    </section>
    <ProofPanel result={result} fingerprint={documentFingerprint(doc)} />
  </aside>;
}
