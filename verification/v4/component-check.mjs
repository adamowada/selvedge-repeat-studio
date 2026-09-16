// Direct handler/JSX assertions on source components. Hooks are a tiny fixture
// shim; effects and React scheduling are not exercised. NOT a React test run.
import assert from 'node:assert/strict';
import { load, mount, find, html, makeFixture, setFixture } from './source-harness.mjs';
const { CellControls } = load('src/components/CellControls.tsx');
const { OutputPanel } = load('src/components/OutputPanel.tsx');
const { ProofPanel } = load('src/components/ProofPanel.tsx');
const { Workspace } = load('src/components/Workspace.tsx');
const { SelectionToolbar } = load('src/components/SelectionToolbar.tsx');
const { AssetTray } = load('src/components/AssetTray.tsx');
const App = load('src/App.tsx').default;
let passed=0, failed=0;
const check = (name, fn) => { try { fn(); console.log('PASS '+name); passed++; } catch(e) { console.error('FAIL '+name+'\n'+e.stack); failed++; } };
const byLabel = (node, label) => find(node,n=>n.props['aria-label']===label);
const byTest = (node, name) => find(node,n=>n.props['data-testid']===name);
const byClass = (node, name) => find(node,n=>n.props.className?.split(' ').includes(name));
const noop=()=>{};
const doc={W:1000,H:1000,mode:'straight',background:'#ffffff',placements:[]};
const controls = commit => mount(CellControls,{doc,busy:false,commit,inspect:false,onFit:noop,onInspect:noop});
check('dimension draft does not commit until blur',()=>{
  const seen=[];const c=controls(value=>{seen.push(value);return true;});
  byLabel(c.render(),'Cell width').props.onChange({target:{value:'501'}});
  assert.equal(seen.length,0);
  byLabel(c.render(),'Cell width').props.onBlur();
  assert.equal(seen.length,1);assert.equal(seen[0].W,501);assert.equal(seen[0].H,1000);
});
check('rejected dimension restores the visible committed value',()=>{
  const c=controls(()=>false);
  byLabel(c.render(),'Cell width').props.onChange({target:{value:'1.5'}});
  byLabel(c.render(),'Cell width').props.onBlur();
  assert.equal(byLabel(c.render(),'Cell width').props.value,'1000');
});
check('Enter prevents defaults and blurs the field for one commit path',()=>{
  let prevented=0,blurred=0;const c=controls(()=>true);
  byLabel(c.render(),'Cell width').props.onKeyDown({key:'Enter',preventDefault:()=>prevented++,currentTarget:{blur:()=>blurred++}});
  assert.equal(prevented,1);assert.equal(blurred,1);
});
check('color draft supports the blur fallback',()=>{
  const seen=[];const c=controls(value=>{seen.push(value);return true;});
  byLabel(c.render(),'Background color').props.onChange({target:{value:'#345678'},currentTarget:{value:'#345678'},nativeEvent:{type:'input'}});
  assert.equal(seen.length,0);
  byLabel(c.render(),'Background color').props.onBlur({currentTarget:{value:'#345678'}});
  assert.equal(seen[0].background,'#345678');
});
check('rejected color commit resets its draft',()=>{
  const c=controls(()=>false);
  byLabel(c.render(),'Background color').props.onChange({target:{value:'#345678'},currentTarget:{value:'#345678'},nativeEvent:{type:'input'}});
  byLabel(c.render(),'Background color').props.onBlur({currentTarget:{value:'#345678'}});
  assert.equal(byLabel(c.render(),'Background color').props.value,'#ffffff');
});
check('transparent toggles the existing background contract without losing placement transforms',()=>{
  let saved;const c=controls(value=>{saved=value;return true;});
  byLabel(c.render(),'Transparent background').props.onChange({target:{checked:true}});
  assert.deepEqual(saved,{background:null});
});
check('transparent state disables the swatch and uses its last chosen color when restored',()=>{
  let saved;const c=mount(CellControls,{doc:{...doc,background:null},busy:false,commit:v=>{saved=v;return true;},inspect:false,onFit:noop,onInspect:noop},['1000','1000','#345678']);
  assert.equal(byLabel(c.render(),'Background color').props.disabled,true);
  byLabel(c.render(),'Transparent background').props.onChange({target:{checked:false}});
  assert.equal(saved.background,'#345678');
});
check('no selection removes unusable placement actions',()=>{
  const tree=mount(SelectionToolbar,{selected:false,busy:false,onAction:noop}).render();
  assert.equal(byLabel(tree,'Delete'),null);assert.ok(byClass(tree,'no-selection'));
});
check('selection actions have semantic groups and forward exactly their action',()=>{
  const seen=[];const tree=mount(SelectionToolbar,{selected:true,name:'source',busy:false,onAction:a=>seen.push(a)}).render();
  for(const [label,key] of [['Duplicate','duplicate'],['Flip horizontal','flipH'],['Flip vertical','flipV'],['Bring to front','front'],['Send to back','back'],['Delete','delete']]) {
    byLabel(tree,label).props.onClick();assert.equal(seen.at(-1),key);
  }
  assert.ok(byLabel(tree,'Placement stacking'));assert.ok(byClass(tree,'selection-context'));
});
const output = extra => mount(OutputPanel,{doc,result:null,busy:false,exporting:false,error:null,onExport:noop,...extra}).render();
check('gesture lock disables export without claiming a PNG is rendering',()=>{
  const button=byClass(output({busy:true}),'export-panel-button');
  assert.equal(button.props.disabled,true);assert.equal(button.props['aria-busy'],false);
  assert.ok(html(button).includes('Export PNG'));assert.ok(!html(button).includes('Rendering'));
});
check('real export activity has a distinct busy state',()=>{
  const button=byClass(output({busy:true,exporting:true}),'export-panel-button');
  assert.equal(button.props.disabled,true);assert.equal(button.props['aria-busy'],true);assert.ok(html(button).includes('Rendering PNG'));
});
check('only a matching, decoded Blob displays proof',()=>{
  const blob=new Blob(['a']), result={blob,width:1000,height:1000,fingerprint:'current'};
  const tree=mount(ProofPanel,{result,fingerprint:'current'},[{blob,decoded:true,error:null}]).render();
  assert.equal(byTest(tree,'export-proof').props.hidden,false);assert.ok(html(tree).includes('Decoded PNG · dimensions verified'));
});
check('a new Blob hides the previous proof until its own decode completes',()=>{
  const old=new Blob(['old']),result={blob:new Blob(['new']),width:1000,height:1000,fingerprint:'current'};
  const tree=mount(ProofPanel,{result,fingerprint:'current'},[{blob:old,decoded:true,error:null}]).render();
  assert.equal(byTest(tree,'export-proof').props.hidden,true);assert.ok(html(tree).includes('Decoding exported PNG'));assert.ok(!html(tree).includes('dimensions verified'));
});
check('a stale proof keeps its picture but loses its success state',()=>{
  const blob=new Blob(['a']),result={blob,width:1000,height:1000,fingerprint:'old'};
  const tree=mount(ProofPanel,{result,fingerprint:'new'},[{blob,decoded:true,error:null}]).render();
  assert.equal(byTest(tree,'export-proof').props.hidden,false);assert.ok(byTest(tree,'proof-stale'));assert.ok(html(tree).includes('edits not included'));assert.ok(!html(tree).includes('dimensions verified'));
});
check('failed stale proof keeps an explicit stale badge AND the failure',()=>{
  const blob=new Blob(['a']),result={blob,width:1000,height:1000,fingerprint:'old'};
  const tree=mount(ProofPanel,{result,fingerprint:'new'},[{blob,decoded:false,error:'decode failure'}]).render();
  assert.ok(byTest(tree,'proof-stale'));assert.equal(byTest(tree,'export-proof').props.hidden,true);assert.ok(html(tree).includes('PNG verification failed'));
});
check('Fit and Inspect wire through the existing studio and return focus to the workspace',()=>{
  const fixture=makeFixture('selected');let fits=0,focus=0;fixture.fit=()=>fits++;fixture.focusRef.current={focus:()=>focus++};setFixture(fixture);
  const app=mount(App,{});let tree=app.render();let cell=find(tree,n=>n.type===CellControls);
  assert.equal(cell.props.inspect,false);cell.props.onFit();assert.equal(fits,1);assert.equal(focus,1);
  cell.props.onInspect();tree=app.render();cell=find(tree,n=>n.type===CellControls);
  assert.equal(cell.props.inspect,true);assert.equal(focus,2);assert.equal(find(tree,n=>n.type===Workspace).props.inspect,true);
});
check('history and assets remain outside the lifted Inspect state',()=>{
  const fixture=makeFixture('selected');setFixture(fixture);const before=JSON.stringify(fixture.history);const assets=fixture.assets;
  const app=mount(App,{});find(app.render(),n=>n.type===CellControls).props.onInspect();
  assert.equal(JSON.stringify(fixture.history),before);assert.equal(fixture.assets,assets);
});
check('inserting/selecting is visibly disabled during a gesture, import still adds session-only assets',()=>{
  const fixture=makeFixture('selected');
  const tree=mount(AssetTray,{assets:fixture.assets,placements:fixture.history.present.placements,selected:'p0',loading:false,busy:true,errors:[],onFiles:noop,onInsert:noop,onSelect:noop,clearErrors:noop}).render();
  assert.equal(byTest(tree,'asset-card').props.disabled,true);assert.equal(byTest(tree,'placement-item').props.disabled,true);
  assert.equal(byClass(tree,'upload-zone').props.disabled,false);
});
// Minimum DOM class identities needed by the source's form-field shortcut guard.
globalThis.HTMLElement=class { constructor(field=false){this.field=field;} closest(){return this.field?this:null;} };
globalThis.HTMLButtonElement=class extends HTMLElement {};
const workProps = () => ({doc,assets:new Map(),camera:{x:0,y:0,z:1},selection:null,pin:null,size:{width:1000,height:500},busy:false,error:null,focusRef:{current:null},inspect:false,demoBusy:false,onDemo:noop,onSize:noop,onCamera:noop,onSelect:noop,onBegin:noop,onNode:noop,onEnd:noop,onAction:noop,onNudge:noop,onNudgeEnd:noop,onFit:noop,clearError:noop,onStage:noop});
check('workspace keyboard guard leaves form input defaults and documents alone',()=>{
  const props=workProps();let actions=0,prevented=0;props.onAction=()=>actions++;
  mount(Workspace,props).render().props.onKeyDown({target:new HTMLElement(true),key:'d',code:'KeyD',ctrlKey:true,preventDefault:()=>prevented++});
  assert.equal(actions,0);assert.equal(prevented,0);
});
check('workspace handled shortcuts prevent defaults and dispatch once',()=>{
  const props=workProps();const actions=[];let prevented=0;props.onAction=a=>actions.push(a);
  const tree=mount(Workspace,props).render();tree.props.onKeyDown({target:new HTMLElement(),key:'d',code:'KeyD',ctrlKey:true,preventDefault:()=>prevented++});
  assert.deepEqual(actions,['duplicate']);assert.equal(prevented,1);
});
check('Space updates modal pan feedback, without dispatching an edit',()=>{
  const props=workProps();let actions=0;props.onAction=()=>actions++;
  const c=mount(Workspace,props);c.render().props.onKeyDown({target:new HTMLElement(),key:' ',code:'Space',preventDefault:noop});
  assert.ok(html(byTest(c.render(),'workspace-hint')).includes('Panning'));assert.ok(byTest(c.render(),'pan-surface'));assert.equal(actions,0);
});
check('dense view offers Fit only after bounded preflight; no partial motif scene is returned',()=>{
  const props=workProps();props.camera={x:490,y:240,z:.2};props.assets=new Map([['a',{id:'a',nativeW:4096,nativeH:4096,image:{src:'fixture'}}]]);
  props.doc={...doc,W:100,H:100,placements:[{id:'p',assetId:'a',x:50,y:50,s:1,deg:0,flipX:false,flipY:false}]};
  const tree=mount(Workspace,props).render();
  assert.ok(find(tree,n=>n.type==='button'&&n.props.children==='Fit view'));assert.equal(byLabel(tree,'Dismiss workspace message'),null);
  assert.equal(find(tree,n=>n.type==='konva:Image'),null);
});
console.log(`\nSupplemental component source checks: ${passed} passed, ${failed} failed. NOT React/Konva runtime verification.`);
process.exitCode=failed?1:0;
