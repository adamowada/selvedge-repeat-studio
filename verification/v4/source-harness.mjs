// Supplemental source-only harness, NOT React, React-Konva, Vitest or a build.
// It runs the actual component functions to capture DOM markup/handlers; effects
// are suppressed. The Chromium layout audit uses this markup and the real CSS.
// The canvas projection below is SVG, not Konva; it cannot verify gestures/export.
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
export const project = fileURLToPath(new URL('../../', import.meta.url));
let current = null, fixture = null;
const h = (type, props, key) => ({ type, props: { ...props }, key });
const react = {
  useState: initial => {
    const i = current.index++, scope = current;
    if (!(i in scope.values)) scope.values[i] = typeof initial === 'function' ? initial() : initial;
    return [scope.values[i], value => { scope.values[i] = typeof value === 'function' ? value(scope.values[i]) : value; }];
  },
  useRef: value => ({ current: value }),
  useEffect: () => {}, useLayoutEffect: () => {},
  useMemo: fn => fn(), useCallback: fn => fn,
};
const cache = new Map();
export function load(file) {
  let filename = resolve(project, file);
  if (!extname(filename)) filename += existsSync(filename + '.tsx') ? '.tsx' : '.ts';
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} }; cache.set(filename, mod);
  const source = ts.transpileModule(readFileSync(filename, 'utf8').replaceAll('import.meta.env.MODE', "'fixture'").replaceAll('import.meta.env.BASE_URL', "'/'"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: h, jsxs: h, Fragment: 'fragment' };
    if (name === 'react-konva') return Object.fromEntries(['Stage','Group','Layer','Rect','Line','Text','Image','Transformer'].map(n => [n, `konva:${n}`]));
    if (name === 'konva') return {};
    if (name.endsWith('hooks/useStudio')) return { useStudio: () => fixture };
    if (name.startsWith('.')) return load(resolve(dirname(filename), name));
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, mod, mod.exports);
  return mod.exports;
}
export function mount(Component, props, values = []) {
  const scope = { values, index: 0 };
  return { scope, render: () => {
    const prior = current; current = scope; scope.index = 0;
    try { return Component(props); } finally { current = prior; }
  } };
}
export function find(node, predicate) {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return null; }
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const escape = v => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const attrs = props => Object.entries(props).filter(([k,v]) => !['children','key','ref','style'].includes(k) && !k.startsWith('on') && v != null && (v !== false || k.startsWith('aria-') || k === 'draggable') && typeof v !== 'object').map(([k,v]) => ` ${k === 'className' ? 'class' : k === 'tabIndex' ? 'tabindex' : k === 'strokeWidth' ? 'stroke-width' : k === 'strokeLinecap' ? 'stroke-linecap' : k === 'strokeLinejoin' ? 'stroke-linejoin' : k}="${escape(typeof v === 'boolean' && k.startsWith('aria-') ? String(v) : v === true ? '' : v)}"`).join('');
const voidTags = new Set(['input','img','br','hr','meta','link']);
function scene(type,p) {
  const kids = () => html(p.children);
  const transform = `translate(${p.x || 0} ${p.y || 0}) rotate(${p.rotation || 0}) scale(${p.scaleX ?? 1} ${p.scaleY ?? 1})`;
  switch(type) {
    case 'Stage': return `<svg width="100%" height="100%" viewBox="0 0 ${p.width} ${p.height}" aria-label="Static scene projection (not Konva)">${kids()}</svg>`;
    case 'Group': return `<g transform="${transform}">${kids()}</g>`;
    case 'Layer': return kids();
    case 'Image': return `<image href="${escape(p.image.src)}" width="${p.width}" height="${p.height}" x="${-p.offsetX}" y="${-p.offsetY}" transform="${transform}" />`;
    case 'Rect': return `<rect x="${p.x||0}" y="${p.y||0}" width="${p.width}" height="${p.height}" fill="${p.fill}" />`;
    case 'Line': return `<polygon points="${p.points.join(' ')}" fill="none" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-dasharray="${p.dash?.join(' ')}" />`;
    case 'Text': return `<text x="${p.x||0}" y="${(p.y||0) + p.fontSize}" font-family="Arial" font-size="${p.fontSize}" fill="${p.fill}">${escape(p.text)}</text>`;
    default: return '';
  }
}
export function html(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(html).join('');
  if (typeof node !== 'object') return escape(node);
  if (typeof node.type === 'function') {
    const seed = node.type.name === 'ProofPanel' && fixture?.result
      ? [{ blob: fixture.result.blob, decoded: !fixture.pendingProof, error: fixture.proofError ?? null }] : [];
    return html(mount(node.type,node.props,seed).render());
  }
  if (node.type === 'fragment') return html(node.props.children);
  if (node.type.startsWith('konva:')) return scene(node.type.slice(6),node.props);
  const {type,props} = node;
  return `<${type}${attrs(props)}>${voidTags.has(type) ? '' : html(props.children)+`</${type}>`}`;
}
export function makeFixture(kind, viewWidth = 1480, viewHeight = 900) {
  const demos = ['coral-stem','sage-sprig','ochre-petal'];
  const assets = kind === 'empty' ? [] : demos.map((name,i) => {
    const bytes = readFileSync(join(project,`public/demo/${name}.png`));
    return { id:`a${i}`, name:kind==='longnames' ? 'a-long-source-image-name-that-needs-truncation-'+name : name, nativeW:bytes.readUInt32BE(16), nativeH:bytes.readUInt32BE(20), image:{src:`data:image/png;base64,${bytes.toString('base64')}`} };
  });
  const placements = assets.map((a,i)=>({id:`p${i}`,assetId:a.id,x:[250,730,320][i],y:[280,580,800][i],s:kind==='stale' && i===0 ? 1.3 : 1,deg:[-12,24,-18][i],flipX:kind==='stale' && i===0,flipY:false}));
  const selected = kind !== 'empty' && kind !== 'demo';
  const W = kind==='dimensions' ? 2048 : 1000, H = kind==='dimensions' ? 4096 : 1000;
  const doc = {W,H,mode:kind==='dimensions'?'half-drop':'straight',background:'#ffffff',placements};
  const sidebars = viewWidth<=1080 ? 400 : viewWidth<=1250 ? 424 : 448;
  const size = {width:viewWidth-sidebars,height:viewHeight-(viewWidth<=1080?90:52)-48-44-32};
  const z = Math.min(size.width / 3200, size.height / 3100);
  const camera = {x:size.width/2-500*z,y:size.height/2-500*z,z};
  const noop = () => {}, ref = () => ({current:null});
  const out = {
    history:{present:doc,past:placements.length?[doc]:[],future:[],baseline:kind==='gesture'?doc:null},
    assets,assetMap:new Map(assets.map(a=>[a.id,a])),selection:selected?{id:'p0',i:0,j:0}:null,pin:null,camera,size,
    exporting:kind==='exporting',loading:0,importErrors:kind==='errors'?['corrupted-long-image-name.png: Not a valid PNG file.','oversized.png: PNG dimensions must be 1–4096 px per side (received 5000 × 3000).']:[],
    error:kind==='errors'?'Cell width and height must be whole pixels from 1 to 4096.':null,exportError:null,result:null,
    focusRef:ref(),historyRef:ref(),stageRef:ref(),
  };
  for (const key of ['action','addDemo','commitSettings','selectCopy','zoom','panBy','tryDocument','setImportErrors','onFiles','insert','selectPlacement','setSelection','begin','onNode','end','nudge','endNudge','fit','setError','onStage','onSize','tryCamera','doExport']) out[key]=noop;
  if (['proof','stale','pending','failed'].includes(kind)) out.result={blob:new Blob(['fixture']),width:1000,height:1000,fingerprint:kind==='stale'?'old':JSON.stringify(doc)};
  out.pendingProof = kind==='pending'; out.proofError = kind==='failed'?'Fixture decode failure':null;
  return out;
}
export function setFixture(value) { fixture = value; }
export function snapshot(kind,width=1480,height=900) {
  fixture = makeFixture(kind,width,height);
  const app = load('src/App.tsx').default;
  const markup = html(mount(app,{}).render());
  const css = readFileSync(join(project,'src/styles.css'),'utf8');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destination = process.argv[2] || join(project,'verification/v4/static-fixtures');
  mkdirSync(destination,{recursive:true});
  for (const [kind,width,height] of [['empty',1480,900],['selected',1480,900],['selected',1280,800],['selected',900,650],['selected',960,600],['errors',960,700],['stale',1480,900],['exporting',1480,900],['dimensions',900,650],['proof',1280,700],['errors',900,600],['stale',900,650],['pending',1280,800],['failed',1280,800],['longnames',900,650]]) {
    writeFileSync(join(destination,`${kind}-${width}x${height}.html`),snapshot(kind,width,height));
  }
  console.log('Source-only DOM/CSS fixtures generated. Effects disabled; scene is an SVG projection, not Konva.');
}
