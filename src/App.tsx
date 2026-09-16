import { useEffect, useRef, useState } from 'react';
import { AssetTray } from './components/AssetTray';
import { CellControls } from './components/CellControls';
import { Icon } from './components/Icon';
import { OutputPanel } from './components/OutputPanel';
import { Workspace } from './components/Workspace';
import { useStudio } from './hooks/useStudio';
import { makeSmokeBridge } from './smokeBridge';

export default function App() {
  const s = useStudio();
  const [inspect, setInspect] = useState(false);
  const latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    // This branch and its bridge are eliminated from normal production builds.
    if (import.meta.env.MODE !== 'smoke') return;
    window.__studio = makeSmokeBridge(() => latest.current);
    return () => { delete window.__studio; };
  }, []);
  const doc = s.history.present;
  const selected = doc.placements.find(p => p.id === s.selection?.id);
  const selectedAsset = s.assets.find(a => a.id === selected?.assetId);
  const busy = s.history.baseline !== null || s.exporting;
  const focusWorkspace = () => s.focusRef.current?.focus({ preventScroll: true });

  return <div className="app-shell"
    // Suppress browser navigation for dropped images/URLs, including non-file
    // thumbnail drags. Only actual files are routed to the local importer.
    onDragOverCapture={e => { e.preventDefault(); if (!e.dataTransfer.types.includes('Files')) e.dataTransfer.dropEffect = 'none'; }}
    onDropCapture={e => e.preventDefault()}
    onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); void s.onFiles(Array.from(e.dataTransfer.files)); } }}>
    <header className="app-header">
      <span className="brand-name">Selvedge <span>Repeat</span></span>
      <span className="session-note">Local session <span aria-hidden="true">·</span> Refresh clears work</span>
      <div className="header-actions">
        <div className="history-buttons" role="group" aria-label="Document history">
          <button className="icon-button" aria-label="Undo" title="Undo · Ctrl/Cmd Z" disabled={!s.history.past.length || busy} onClick={() => s.action('undo')}><Icon name="undo" /></button>
          <button className="icon-button" aria-label="Redo" title="Redo · Ctrl/Cmd Shift Z" disabled={!s.history.future.length || busy} onClick={() => s.action('redo')}><Icon name="redo" /></button>
        </div>
        <button className="text-button demo-button" aria-label="Add demo" disabled={!!s.loading || busy} onClick={() => void s.addDemo()}>Demo</button>
      </div>
    </header>
    <CellControls doc={doc} busy={busy} commit={s.commitSettings} inspect={inspect}
      onFit={() => { s.fit(); focusWorkspace(); }}
      onInspect={() => { setInspect(value => !value); focusWorkspace(); }} />
    <main className="studio-layout">
      <AssetTray assets={s.assets} placements={doc.placements} selected={s.selection?.id} loading={!!s.loading} busy={busy}
        errors={s.importErrors} onFiles={files => void s.onFiles(files)} onInsert={s.insert} onSelect={s.selectPlacement}
        retainedAssets={s.retainedAssets} onRemove={s.removeAsset}
        clearErrors={() => s.setImportErrors([])} />
      <Workspace doc={doc} assets={s.assetMap} camera={s.camera} selection={s.selection} selectedName={selectedAsset?.name}
        pin={s.pin} size={s.size} busy={busy} error={s.error} focusRef={s.focusRef} inspect={inspect}
        demoBusy={!!s.loading || busy} onDemo={() => void s.addDemo()}
        onSize={s.onSize} onZoom={s.zoom} onPan={s.panBy} onSelect={s.selectCopy} onBegin={s.begin} onNode={s.onNode}
        onEnd={s.end} onAction={s.action} onNudge={s.nudge} onNudgeEnd={s.endNudge} onFit={s.fit}
        clearError={() => s.setError(null)} onStage={s.onStage} />
      <OutputPanel doc={doc} selected={selected} asset={selectedAsset} result={s.result} busy={busy}
        onTransform={s.commitTransform}
        exporting={s.exporting} error={s.exportError} onExport={() => void s.doExport()} />
    </main>
  </div>;
}
