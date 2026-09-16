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
  const projectInput = useRef<HTMLInputElement>(null);
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
  const busy = s.history.baseline !== null || s.exporting || s.projectBusy;
  const focusWorkspace = () => s.focusRef.current?.focus({ preventScroll: true });

  return <div className="app-shell"
    // Suppress browser navigation for dropped images/URLs, including non-file
    // thumbnail drags. Only actual files are routed to the local importer.
    onDragOverCapture={e => { e.preventDefault(); if (!e.dataTransfer.types.includes('Files')) e.dataTransfer.dropEffect = 'none'; }}
    onDropCapture={e => e.preventDefault()}
    onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); void s.onFiles(Array.from(e.dataTransfer.files)); } }}>
    <header className="app-header">
      <span className="brand-name">Selvedge <span>Repeat</span></span>
      <span className="session-note" title={`${s.projectName} · Save a project file to keep your work`} role="status">
        {s.projectName} · {s.projectBusy ? 'Working…' : s.dirty ? 'Unsaved changes' : 'No unsaved changes'}
      </span>
      <div className="header-actions">
        <input ref={projectInput} data-testid="project-input" type="file" accept=".selvedge" hidden
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void s.openProject(file); }} />
        <button className="secondary" disabled={busy || !!s.loading} onClick={() => projectInput.current?.click()}>Open project</button>
        <button className="secondary" disabled={busy || !!s.loading} onClick={() => void s.saveProject()}>Save project</button>
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
      <AssetTray assets={s.assets} placements={doc.placements} selected={s.selection?.id} loading={!!s.loading || s.projectBusy} busy={busy}
        errors={s.importErrors} onFiles={files => void s.onFiles(files)} onInsert={s.insert} onSelect={s.selectPlacement}
        onRemove={id => { const removed = s.removeAsset(id); if (removed) focusWorkspace(); return removed; }}
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
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} Adam Owada</span>
      <span className="dedication">Made with love for my sister Aubrey</span>
      <a className="github-link" href="https://github.com/adamowada/selvedge-repeat-studio" target="_blank" rel="noopener noreferrer"
        aria-label="View Selvedge Repeat on GitHub (opens in a new tab)" title="View source on GitHub">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
      </a>
    </footer>
  </div>;
}
