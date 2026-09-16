// Behavior of actual source at mocked React/Konva/I/O boundaries. NOT a live
// application test. See source-runtime.mjs for the explicit harness limits.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHarness, ElementStub, find, byTest, byLabel, event, deferred } from './source-runtime.mjs';
const project = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../../', import.meta.url));
const baseline = process.argv.includes('--baseline');
const results = [];
async function check(name, fn, beforeCompatible = false) {
  if (baseline && !beforeCompatible) return;
  try { await fn(); console.log(`PASS ${name}`); results.push({ name, pass: true }); }
  catch (error) { console.error(`FAIL ${name}\n${error.stack}`); results.push({ name, pass: false }); }
}
const asset = id => ({ id, name: id, nativeW: 40, nativeH: 60, image: { src: `blob:${id}` } });
const blank = { W: 1000, H: 1000, mode: 'straight', background: '#ffffff', placements: [] };
async function studio() {
  const h = createHarness(project);
  const m = h.mount(h.load('src/hooks/useStudio.ts').useStudio);
  let s = m.render(); m.flushEffects();
  s.onSize({ width: 800, height: 600 });
  h.ops.importBatch = async files => ({ assets: files[0] === 'demo' ? [asset('d0'), asset('d1'), asset('d2')] : [asset('source')], errors: [] });
  await s.onFiles(['source']); s = m.render();
  s.insert(s.assets[0]); s = m.render();
  return { h, m, s, copy: { id: s.history.present.placements[0].id, i: 0, j: 0, tx: 0, ty: 0 } };
}
const node = p => ({ x: () => p.x, y: () => p.y, scaleX: () => p.s, scaleY: () => p.s, rotation: () => p.deg, setAttrs: () => {} });

await check('P2-01: delayed demo cannot commit over an active pointer transaction', async () => {
  const { h, m, s, copy } = await studio();
  const waiting = deferred(); h.ops.demoFiles = () => waiting.promise;
  const task = s.addDemo(); s.begin(copy);
  const p = s.historyRef.current.present.placements[0];
  s.onNode(copy, node({ ...p, x: p.x + 9 }));
  const during = s.historyRef.current.present;
  waiting.resolve(['demo']); await task;
  const after = m.render();
  assert.equal(after.historyRef.current.present, during);
  assert.notEqual(after.historyRef.current.baseline, null);
  assert.equal(after.assets.length, 4);
  assert.equal(after.pin.id, copy.id);
  assert.match(after.error, /Demo images are ready/);
  s.end(); const ended = m.render(); const past = ended.history.past.length;
  await ended.addDemo(); const retried = m.render();
  assert.equal(retried.history.present.placements.length, 4);
  assert.equal(retried.assets.length, 4);
  assert.equal(retried.history.past.length, past + 1);
}, true);

await check('P2-01: a generic document commit cannot close a held nudge', async () => {
  const { s } = await studio(); s.nudge(1, 0);
  const during = s.historyRef.current.present;
  assert.equal(s.tryDocument({ ...during, W: 900 }), false);
  assert.equal(s.historyRef.current.present, during);
  assert.notEqual(s.historyRef.current.baseline, null);
}, true);

await check('P2-01: delayed demo during export retains assets without touching export or focus', async () => {
  const { h, m, s } = await studio(); const demo = deferred(), encoding = deferred();
  let focus = 0; s.focusRef.current = { focus: () => focus++ };
  h.ops.demoFiles = () => demo.promise; h.ops.exportPng = () => encoding.promise;
  const pendingDemo = s.addDemo(); const exporting = s.doExport(); const doc = s.historyRef.current.present;
  demo.resolve(['demo']); await pendingDemo;
  assert.equal(s.historyRef.current.present, doc); assert.equal(focus, 0);
  const after = m.render(); assert.equal(after.assets.length, 4); assert.equal(after.exporting, true);
  assert.match(after.error, /Demo images are ready/);
  encoding.resolve({ blob: new Blob(['png']), width: 1000, height: 1000, fingerprint: JSON.stringify(doc) });
  await exporting; assert.equal(m.render().exporting, false);
});

await check('P2-01: valid demo still appends to the latest intervening document', async () => {
  const { h, m, s } = await studio(); const wait = deferred(); h.ops.demoFiles = () => wait.promise;
  const task = s.addDemo(); s.commitSettings({ W: 901, H: 703 });
  const p = s.historyRef.current.present.placements[0];
  wait.resolve(['demo']); await task; const after = m.render();
  assert.equal(after.history.present.W, 901); assert.equal(after.history.present.H, 703);
  assert.equal(after.history.present.placements[0], p);
  assert.equal(after.history.present.placements[1].x, 225.25);
  assert.equal(after.assets.length, 4);
});

await check('P2-01: unmount during demo decode releases arriving assets and never inserts', async () => {
  const { h, m, s } = await studio(); const wait = deferred(); const released = [];
  h.ops.releaseAssets = assets => released.push(...assets.map(a => a.id));
  h.ops.demoFiles = () => wait.promise; const task = s.addDemo(); const before = s.historyRef.current.present;
  m.unmount(); wait.resolve(['demo']); await task;
  assert.equal(s.historyRef.current.present, before);
  assert.deepEqual(released, ['source', 'd0', 'd1', 'd2']);
});

await check('gesture identity: late copy updates and ends cannot consume another pin', async () => {
  const { m, s, copy } = await studio(); const wrong = { ...copy, i: 1, tx: 1000 };
  assert.equal(s.begin(copy), true); assert.equal(s.begin(copy), true);
  assert.equal(s.begin(wrong), false);
  const during = s.historyRef.current.present;
  s.onNode(wrong, node({ ...during.placements[0], x: 1234 })); s.end(wrong);
  assert.equal(s.historyRef.current.present, during); assert.notEqual(s.historyRef.current.baseline, null);
  s.selectCopy(null); assert.equal(m.render().selection.id, copy.id);
  s.onNode(copy, node({ ...during.placements[0], x: 123 })); s.end(copy);
  assert.equal(s.historyRef.current.present.placements[0].x, 123);
  assert.equal(s.historyRef.current.baseline, null);
});

await check('gesture identity: switching copy commits a nudge before changing selection', async () => {
  const { s, copy } = await studio(); const past = s.historyRef.current.past.length;
  s.nudge(1, 0); s.selectCopy({ ...copy, i: 1 });
  assert.equal(s.historyRef.current.baseline, null); assert.equal(s.historyRef.current.past.length, past + 1);
  s.nudge(0, 10); s.endNudge(); assert.equal(s.historyRef.current.past.length, past + 2);
});

await check('settings patch uses current document even through an older callback', async () => {
  const { s, copy } = await studio(); const change = s.commitSettings;
  const p = s.historyRef.current.present.placements[0];
  s.begin(copy); s.onNode(copy, node({ ...p, x: p.x + 21 })); s.end(copy);
  assert.equal(change({ background: '#123456' }), true);
  assert.equal(s.historyRef.current.present.placements[0].x, p.x + 21);
  assert.equal(s.historyRef.current.present.background, '#123456');
});

await check('preview outside a transaction is not falsely reported as accepted', async () => {
  const { s } = await studio(); const before = s.historyRef.current.present;
  assert.equal(s.tryDocument({ ...before, W: 600 }, true), false);
  assert.equal(s.historyRef.current.present, before);
});

await check('P2-02: interleaved zoom/pan uses current refs without requiring a render', async () => {
  const { m, s } = await studio(); const before = s.historyRef.current;
  assert.equal(s.tryCamera({ x: 100, y: 50, z: 1 }), true);
  assert.equal(s.panBy(20, -10), true);
  assert.equal(s.zoom({ x: 300, y: 200 }, 2), true);
  assert.equal(s.panBy(7, 11), true);
  assert.deepEqual(m.render().camera, { x: -53, y: -109, z: 2 });
  assert.equal(s.historyRef.current, before);
});

await check('P2-02: invalid pan/zoom does not change the camera or document', async () => {
  const { m, s } = await studio(); const before = m.render().camera;
  assert.equal(s.panBy(Infinity, 0), false);
  assert.equal(s.zoom({ x: NaN, y: 0 }, 2), false);
  assert.deepEqual(m.render().camera, before);
});

function workspace(h, props = {}) {
  const all = { doc: blank, assets: new Map(), camera: { x: 100, y: 50, z: 1 }, selection: null, pin: null,
    size: { width: 800, height: 600 }, busy: false, error: null, focusRef: { current: null }, inspect: false,
    demoBusy: false, onDemo() {}, onSize() {}, onCamera() { return true; }, onZoom() { return true; }, onPan() { return true; },
    onSelect() {}, onBegin() { return true; }, onNode() {}, onEnd() {}, onAction() {}, onNudge() {}, onNudgeEnd() {}, onFit() {}, clearError() {}, onStage() {}, ...props };
  const mount = h.mount(h.load('src/components/Workspace.tsx').Workspace, all);
  const tree = mount.render(); const host = new ElementStub(); byTest(tree, 'canvas-host').props.ref.current = host;
  mount.flushEffects(); return { m: mount, props: all, host };
}
function key(tree, key, extra = {}) {
  let prevented = false; tree.props.onKeyDown({ target: new ElementStub(), key, code: key === ' ' ? 'Space' : key,
    shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() { prevented = true; }, ...extra });
  return prevented;
}
function up(h, m, key) {
  const e = event('keyup', { key, code: key });
  // v3 used a React keyup handler as well as a window Space listener.
  m.render().props.onKeyUp?.(e);
  h.window.dispatchEvent(e); return e;
}
function pointer(type, target, x, y, extra = {}) {
  return { currentTarget: target, clientX: x, clientY: y, pointerId: 1, isPrimary: true,
    button: 0, buttons: type === 'up' ? 0 : 1, preventDefault() {}, ...extra };
}

await check('P2-02: real source pan handlers do not snap back after wheel zoom', () => {
  const h = createHarness(project); let camera = { x: 100, y: 50, z: 1 };
  const w = workspace(h, { onCamera: next => { camera = next; return true; },
    onPan: (dx, dy) => { camera = { ...camera, x: camera.x + dx, y: camera.y + dy }; return true; } });
  key(w.m.render(), ' '); let surface = byTest(w.m.render(), 'pan-surface'); const el = new ElementStub();
  surface.props.onPointerDown(pointer('down', el, 200, 200));
  surface.props.onPointerMove(pointer('move', el, 220, 210));
  // Simulate an accepted wheel zoom, then React's next render while the button remains held.
  camera = { x: 10, y: 20, z: 2 }; w.props.camera = camera; surface = byTest(w.m.render(), 'pan-surface');
  surface.props.onPointerMove(pointer('move', el, 225, 216));
  assert.deepEqual(camera, { x: 15, y: 26, z: 2 });
}, true);

await check('P2-02: non-primary buttons and unrelated pointers cannot pan', () => {
  const h = createHarness(project); let moves = 0; const w = workspace(h, { onPan: () => { moves++; return true; } });
  key(w.m.render(), ' '); const surface = byTest(w.m.render(), 'pan-surface'); const el = new ElementStub();
  surface.props.onPointerDown(pointer('down', el, 0, 0, { button: 2 }));
  surface.props.onPointerMove(pointer('move', el, 8, 9)); assert.equal(moves, 0);
  surface.props.onPointerDown(pointer('down', el, 0, 0));
  surface.props.onPointerMove(pointer('move', el, 8, 9, { pointerId: 2 })); assert.equal(moves, 0);
  surface.props.onPointerMove(pointer('move', el, 8, 9)); assert.equal(moves, 1);
  surface.props.onPointerCancel(pointer('cancel', el, 8, 9));
  surface.props.onPointerMove(pointer('move', el, 10, 10)); assert.equal(moves, 1);
});

await check('P2-06: releasing one held arrow keeps the nudge open until the last release', () => {
  const h = createHarness(project); let ended = 0; const nudges = [];
  const w = workspace(h, { selection: { id: 'p', i: 0, j: 0 }, onNudge: (x, y) => nudges.push([x, y]), onNudgeEnd: () => ended++ });
  key(w.m.render(), 'ArrowRight'); key(w.m.render(), 'ArrowDown', { shiftKey: true });
  assert.equal(up(h, w.m, 'ArrowRight').defaultPrevented, true); assert.equal(ended, 0);
  key(w.m.render(), 'ArrowDown', { repeat: true });
  assert.equal(up(h, w.m, 'ArrowDown').defaultPrevented, true); assert.equal(ended, 1);
  assert.deepEqual(nudges, [[1, 0], [0, 10], [0, 1]]);
  assert.equal(up(h, w.m, 'ArrowDown').defaultPrevented, false); assert.equal(ended, 1);
}, true);

await check('P2-06: blur ends and clears tracked keys; a later release does not repeat the commit', () => {
  const h = createHarness(project); let ended = 0; const w = workspace(h, { selection: { id: 'p', i: 0, j: 0 }, onNudgeEnd: () => ended++ });
  key(w.m.render(), 'ArrowRight');
  w.m.render().props.onBlur({ currentTarget: new ElementStub(), relatedTarget: null });
  assert.equal(ended, 1); assert.equal(up(h, w.m, 'ArrowRight').defaultPrevented, false); assert.equal(ended, 1);
});

await check('form input and editable fields never dispatch or suppress workspace keys', () => {
  const h = createHarness(project); let actions = 0, nudges = 0;
  const w = workspace(h, { onAction: () => actions++, onNudge: () => nudges++ });
  for (const target of [new ElementStub({ field: true }), new ElementStub({ editable: true })]) {
    for (const name of ['ArrowRight', 'Delete', ' ']) assert.equal(key(w.m.render(), name, { target }), false);
    assert.equal(key(w.m.render(), 'd', { target, ctrlKey: true }), false);
  }
  assert.equal(actions, 0); assert.equal(nudges, 0);
});

function colorControl() {
  const h = createHarness(project); const seen = [];
  const props = { doc: blank, busy: false, inspect: false, onFit() {}, onInspect() {}, commit: next => { seen.push(next); return true; } };
  const m = h.mount(h.load('src/components/CellControls.tsx').CellControls, props);
  const input = new ElementStub({ field: true }); input.value = '#ffffff';
  const el = byLabel(m.render(), 'Background color'); if (el.props.ref) el.props.ref.current = input;
  m.flushEffects(); return { m, props, input, seen };
}

await check('P2-03: picker native change commits without blur and input draft does not', () => {
  const c = colorControl(); c.input.value = '#345678';
  byLabel(c.m.render(), 'Background color').props.onChange({ target: c.input, currentTarget: c.input, nativeEvent: { type: 'input' } }); c.m.render();
  assert.equal(c.seen.length, 0); c.input.dispatchEvent(event('change'));
  assert.equal(c.seen.length, 1); assert.equal(c.seen[0].background, '#345678');
}, true);

await check('P2-03: native accept takes the DOM value even before the draft rerenders', () => {
  const c = colorControl(); c.input.value = '#123456';
  byLabel(c.m.render(), 'Background color').props.onChange({ target: c.input, currentTarget: c.input, nativeEvent: { type: 'input' } });
  c.input.dispatchEvent(event('change')); assert.equal(c.seen[0].background, '#123456');
});

await check('P2-03: reject restores visible committed color; latest busy and transparent state are honored', () => {
  const c = colorControl(); c.props.commit = () => false; c.m.render(); c.input.value = '#123456';
  c.input.dispatchEvent(event('change')); assert.equal(byLabel(c.m.render(), 'Background color').props.value, '#ffffff');
  c.props.commit = next => { c.seen.push(next); return true; }; c.props.busy = true; c.m.render();
  c.input.dispatchEvent(event('change')); assert.equal(c.seen.length, 0);
  c.props.busy = false; c.props.doc = { ...blank, background: null }; c.m.render();
  c.input.dispatchEvent(event('change')); assert.equal(c.seen.length, 0);
});

await check('P2-03: a bubbling synthetic change cannot overwrite an accept rejection', () => {
  const c = colorControl(); c.props.commit = () => false; c.m.render(); c.input.value = '#123456';
  const input = byLabel(c.m.render(), 'Background color');
  input.props.onChange({ target: c.input, currentTarget: c.input, nativeEvent: { type: 'input' } });
  c.input.dispatchEvent(event('change'));
  input.props.onChange({ target: c.input, currentTarget: c.input, nativeEvent: { type: 'change' } });
  assert.equal(byLabel(c.m.render(), 'Background color').props.value, '#ffffff');
});

await check('P2-03: the native listener is removed on unmount' , () => {
  const c = colorControl(); c.m.unmount(); c.input.value = '#123456';
  c.input.dispatchEvent(event('change')); assert.equal(c.seen.length, 0);
});

await check('P2-04: non-file image/URL drops are canceled before browser default navigation', () => {
  const h = createHarness(project); const m = h.mount(h.load('src/App.tsx').default); const tree = m.render();
  const e = event('drop', { dataTransfer: { files: [], types: ['text/uri-list'] } });
  tree.props.onDropCapture?.(e); tree.props.onDrop?.(e);
  assert.equal(e.defaultPrevented, true);
}, true);

await check('P2-04: thumbnails are explicitly non-draggable in both source and placement lists', () => {
  const h = createHarness(project); const a = asset('source');
  const tree = h.mount(h.load('src/components/AssetTray.tsx').AssetTray, { assets: [a], placements: [{ ...blank, id: 'p', assetId: a.id, x: 0, y: 0, s: 1, deg: 0, flipX: false, flipY: false }], errors: [] }).render();
  for (const testId of ['asset-card', 'placement-item']) {
    assert.equal(find(byTest(tree, testId), n => n.type === 'img').props.draggable, false);
  }
}, true);

await check('P2-04: canceling defaults does not suppress valid file import routing', async () => {
  const h = createHarness(project); const received = [];
  h.ops.importBatch = async files => { received.push(files); return { assets: [], errors: [] }; };
  const tree = h.mount(h.load('src/App.tsx').default).render();
  const e = event('drop', { dataTransfer: { files: ['file'], types: ['Files'] } });
  tree.props.onDropCapture(e); tree.props.onDrop(e); await Promise.resolve();
  assert.equal(e.defaultPrevented, true); assert.deepEqual(received, [['file']]);
});

await check('P2-05: a thrown download initiation cannot publish a new proof', async () => {
  const { h, m, s } = await studio(); await s.doExport(); const previous = m.render().result;
  const doc = { ...s.historyRef.current.present, background: '#345678' }; s.tryDocument(doc);
  h.ops.downloadPng = () => { throw new Error('Deliberate download failure'); };
  await s.doExport(); const after = m.render();
  assert.equal(after.result, previous); assert.equal(after.exporting, false);
  assert.equal(after.exportError, 'Deliberate download failure');
  assert.notEqual(after.result.fingerprint, JSON.stringify(doc));
}, true);

await check('P2-05: failed first download leaves no proof; retry clears failure and publishes exact result', async () => {
  const { h, m, s } = await studio(); h.ops.downloadPng = () => { throw new Error('failed'); };
  await s.doExport(); assert.equal(m.render().result, null);
  let sent; h.ops.downloadPng = result => { sent = result; };
  await s.doExport(); const after = m.render(); assert.equal(after.result, sent);
  assert.equal(after.exportError, null); assert.equal(after.exporting, false);
});

console.log(`\n${baseline ? 'v3 baseline invariant replay' : 'v4 source-boundary checks'}: ${results.filter(r => r.pass).length} passed; ${results.filter(r => !r.pass).length} failed. NOT React/Konva runtime verification.`);
process.exitCode = baseline ? 0 : results.some(r => !r.pass) ? 1 : 0;
