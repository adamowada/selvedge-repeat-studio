// Supplemental replay using the environment's TypeScript and Node assertions.
// This is NOT Vitest and does not exercise React, Konva, or a browser.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const project = fileURLToPath(new URL('../../', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'selvedge-core-replay-'));
try {
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'package.json'), '{"type":"module"}\n');
cpSync(join(project, 'public'), join(out, 'public'), { recursive: true });
for (const folder of ['src/core', 'tests']) {
  mkdirSync(join(out, folder), { recursive: true });
  for (const name of readdirSync(join(project, folder)).filter(n => n.endsWith('.ts'))) {
    let source = ts.transpileModule(readFileSync(join(project, folder, name), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    source = source.replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, q, specifier) => `from ${q}${specifier}.js${q}`)
      .replace(/from (['"])vitest\1/g, "from '../assert-adapter.js'");
    writeFileSync(join(out, folder, name.replace(/\.ts$/, '.js')), source);
  }
}
writeFileSync(join(out, 'assert-adapter.js'), `
import assert from 'node:assert/strict';
import { format } from 'node:util';
let passed = 0, failed = 0;
export function describe(name, fn) { console.log('\\n'+name); fn(); }
export function it(name, fn) {
  try { const result = fn(); assert.equal(result, undefined, 'This replay supports synchronous cases only'); passed++; console.log('PASS '+name); }
  catch (error) { failed++; console.error('FAIL '+name+'\\n'+error.stack); }
}
it.each = rows => (name, fn) => { for (const row of rows) { const args = Array.isArray(row) ? row : [row]; it(format(name, ...args), () => fn(...args)); } };
function partial(actual, expected) {
  if (expected === null || typeof expected !== 'object') { assert.deepEqual(actual, expected); return; }
  assert.ok(actual != null);
  for (const [key,value] of Object.entries(expected)) partial(actual[key], value);
}
export function expect(actual, negate = false) {
  const check = assertion => { if (!negate) assertion(); else assert.throws(assertion, assert.AssertionError); };
  return {
    get not() { return expect(actual, !negate); },
    toBe: expected => check(() => assert.equal(actual, expected)),
    toEqual: expected => check(() => assert.deepEqual(actual, expected)),
    toBeNull: () => check(() => assert.equal(actual, null)),
    toHaveLength: length => check(() => assert.equal(actual.length, length)),
    toBeCloseTo: (expected, digits = 2) => check(() => assert.ok(Math.abs(actual - expected) < .5 * 10 ** -digits, actual+' not close to '+expected)),
    toMatchObject: expected => check(() => partial(actual, expected)),
    toMatch: expected => check(() => assert.match(actual, expected)),
    toThrow: expected => check(() => {
      if (expected === undefined) assert.throws(actual);
      else if (typeof expected === 'string') assert.throws(actual, error => error.message.includes(expected));
      else assert.throws(actual, expected);
    }),
  };
}
export function summary() { console.log('\\nSupplemental Node assertion replay: '+passed+' passed; '+failed+' failed. NOT a Vitest run.'); return failed; }
`);
for (const file of readdirSync(join(out, 'tests')).filter(n => n.endsWith('.test.js')).sort()) await import(join(out, 'tests', file));
const { summary } = await import(join(out, 'assert-adapter.js'));
process.exitCode = summary() ? 1 : 0;

} finally { rmSync(out, { recursive: true, force: true }); }
