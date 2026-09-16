// Audit-only dependency boundary harness. Executes original TS/TSX functions
// with persistent hook slots and explicit effect flushes. It is NOT React or
// Konva, cannot establish rendering/scheduling, and is not a test runner substitute.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const compiled = new Map();

export class ElementStub extends EventTarget {
  constructor({ field = false, editable = false } = {}) {
    super(); this.field = field; this.isContentEditable = editable; this.value = '';
    this.captures = new Set();
  }
  closest() { return this.field ? this : null; }
  contains(target) { return target === this; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 800, height: 600 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() {}
}
globalThis.HTMLElement = ElementStub;
globalThis.HTMLButtonElement = class extends ElementStub {};
globalThis.Node = ElementStub;

export function createHarness(project) {
  let scope = null;
  const windowStub = new EventTarget();
  windowStub.setTimeout = setTimeout;
  globalThis.window = windowStub;
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(fn) { this.fn = fn; observers.push(this); }
    observe() {} disconnect() {}
  };
  const ops = {
    importBatch: async () => ({ assets: [], errors: [] }),
    demoFiles: async () => [],
    releaseAssets: () => {},
    exportPng: async doc => ({ blob: new Blob(['fixture-not-a-png']), width: doc.W, height: doc.H, fingerprint: JSON.stringify(doc) }),
    downloadPng: () => {},
  };
  const slot = (initial) => {
    const index = scope.index++;
    if (!(index in scope.slots)) scope.slots[index] = initial();
    return [scope, index];
  };
  const effect = (fn, deps) => {
    const [s, i] = slot(() => ({ deps: undefined, cleanup: undefined }));
    const old = s.slots[i];
    if (!deps || !old.deps || deps.some((d, n) => !Object.is(d, old.deps[n]))) {
      s.effects.push(() => { old.cleanup?.(); old.cleanup = fn(); });
      old.deps = deps;
    }
  };
  const react = {
    useState(initial) {
      const [s, i] = slot(() => typeof initial === 'function' ? initial() : initial);
      return [s.slots[i], next => { s.slots[i] = typeof next === 'function' ? next(s.slots[i]) : next; }];
    },
    useReducer(reducer, initial, init = x => x) {
      const [s, i] = slot(() => init(initial));
      return [s.slots[i], action => { s.slots[i] = reducer(s.slots[i], action); }];
    },
    useRef(initial) { const [s, i] = slot(() => ({ current: initial })); return s.slots[i]; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect: effect, useLayoutEffect: effect,
  };
  const cache = new Map();
  const jsx = (type, props, key) => ({ type, props: { ...props }, key });
  function load(file) {
    let filename = resolve(project, file);
    if (!extname(filename)) filename += existsSync(filename + '.tsx') ? '.tsx' : '.ts';
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} }; cache.set(filename, mod);
    if (!compiled.has(filename)) {
      const text = readFileSync(filename, 'utf8').replaceAll('import.meta.env.MODE', "'audit'").replaceAll('import.meta.env.BASE_URL', "'/'");
      compiled.set(filename, ts.transpileModule(text, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      }}).outputText);
    }
    const localRequire = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === 'react-konva') return Object.fromEntries(['Stage', 'Group', 'Layer', 'Rect', 'Line', 'Text', 'Image', 'Transformer'].map(n => [n, `konva:${n}`]));
      if (name === 'konva') return {};
      if (name.endsWith('/core/png')) return Object.fromEntries(['importBatch', 'demoFiles', 'releaseAssets'].map(n => [n, (...args) => ops[n](...args)]));
      if (name.endsWith('/core/export')) return {
        documentFingerprint: doc => JSON.stringify(doc),
        exportPng: (...args) => ops.exportPng(...args), downloadPng: (...args) => ops.downloadPng(...args),
      };
      if (name.startsWith('.')) return load(resolve(dirname(filename), name));
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${compiled.get(filename)}\n})`, { filename })(localRequire, mod, mod.exports);
    return mod.exports;
  }
  function mount(fn, props = {}) {
    const state = { index: 0, slots: [], effects: [] };
    return {
      props,
      render() {
        const old = scope; scope = state; state.index = 0;
        try { return fn(props); } finally { scope = old; }
      },
      flushEffects() { const work = state.effects.splice(0); for (const run of work) run(); },
      unmount() { for (const value of state.slots) value?.cleanup?.(); },
    };
  }
  return { load, mount, ops, window: windowStub, observers };
}
export function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) { for (const child of tree) { const result = find(child, predicate); if (result) return result; } return null; }
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
export const byTest = (tree, id) => find(tree, node => node.props?.['data-testid'] === id);
export const byLabel = (tree, label) => find(tree, node => node.props?.['aria-label'] === label);
export function event(type, values = {}) { return Object.assign(new Event(type, { cancelable: true, bubbles: true }), values); }
export function deferred() {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
