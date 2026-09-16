import { useEffect, useRef, useState } from 'react';
import type { DocumentSettings, Mode, RepeatDocument } from '../core/types';
import { MODE_LABELS } from '../ui/presentation';
import { Icon } from './Icon';

interface Props {
  doc: RepeatDocument;
  busy: boolean;
  commit: (patch: Partial<DocumentSettings>) => boolean;
  inspect: boolean;
  onFit: () => void;
  onInspect: () => void;
}
export function CellControls({ doc, busy, commit, inspect, onFit, onInspect }: Props) {
  const [width, setWidth] = useState(String(doc.W));
  const [height, setHeight] = useState(String(doc.H));
  const [color, setColor] = useState(doc.background ?? '#ffffff');
  const colorInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setWidth(String(doc.W)); setHeight(String(doc.H)); }, [doc.W, doc.H]);
  useEffect(() => { if (doc.background) setColor(doc.background); }, [doc.background]);
  const dimensions = () => {
    const W = /^\d+$/.test(width) ? Number(width) : NaN;
    const H = /^\d+$/.test(height) ? Number(height) : NaN;
    if (!commit({ W, H })) { setWidth(String(doc.W)); setHeight(String(doc.H)); }
  };
  const commitColor = (value: string) => {
    if (!doc.background) return;
    if (busy || !commit({ background: value })) setColor(doc.background);
    else setColor(value);
  };
  const latestColorCommit = useRef(commitColor);
  latestColorCommit.current = commitColor;
  useEffect(() => {
    const input = colorInput.current!;
    // React onChange is a draft/input event. The native change event is the
    // picker-accept boundary, even when closing the picker does not blur it.
    const accepted = () => latestColorCommit.current(input.value);
    input.addEventListener('change', accepted);
    return () => input.removeEventListener('change', accepted);
  }, []);
  return <div className="document-toolbar" aria-label="Repeat settings">
    <div className="toolbar-group size-group" role="group" aria-label="Cell size">
      <span className="toolbar-label">Cell</span>
      <div className="dimension-pair">
        <label className="dimension"><span>W</span><input aria-label="Cell width" value={width} inputMode="numeric" disabled={busy}
          onChange={e => setWidth(e.target.value)} onBlur={dimensions}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} /></label>
        <span className="times" aria-hidden="true">×</span>
        <label className="dimension"><span>H</span><input aria-label="Cell height" value={height} inputMode="numeric" disabled={busy}
          onChange={e => setHeight(e.target.value)} onBlur={dimensions}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} /></label>
      </div>
      <span className="unit">px</span>
    </div>
    <div className="toolbar-group mode-group">
      <span className="toolbar-label">Repeat</span>
      <div className="segments" role="group" aria-label="Repeat mode">
        {(['straight', 'half-drop', 'brick'] as Mode[]).map(mode =>
          <button key={mode} aria-pressed={doc.mode === mode} disabled={busy} onClick={() => commit({ mode })}>
            <span className={`mode-icon ${mode}`} aria-hidden="true"><i /><i /><i /><i /></span>{MODE_LABELS[mode]}
          </button>)}
      </div>
    </div>
    <div className="toolbar-group background-group" role="group" aria-label="Background">
      <span className="toolbar-label">Background</span>
      <div className={`background-control ${!doc.background ? 'is-transparent' : ''}`}>
        <label className="color-input" title={doc.background ? 'Background color' : 'Turn off Transparent to choose a color'}>
          <input ref={colorInput} aria-label="Background color" type="color" value={color} disabled={busy || !doc.background}
            onChange={e => {
              // A bubbling synthetic change must not overwrite a native accept
              // rejection. Only input events update the uncommitted draft.
              if (e.nativeEvent.type === 'input' && !busy) setColor(e.currentTarget.value);
            }} onBlur={e => commitColor(e.currentTarget.value)} />
          <span className="color-value" aria-hidden="true">{doc.background ? color.toUpperCase() : 'None'}</span>
        </label>
        <label className="check-label"><input aria-label="Transparent background" type="checkbox" checked={!doc.background} disabled={busy}
          onChange={e => commit({ background: e.target.checked ? null : color })} />Transparent</label>
      </div>
    </div>
    <div className="view-tools" role="group" aria-label="View">
      <button disabled={busy} onClick={onFit}><Icon name="fit" size={16} />Fit</button>
      <button aria-pressed={inspect} disabled={busy} onClick={onInspect}><Icon name="eye" size={16} />Inspect</button>
    </div>
  </div>;
}
