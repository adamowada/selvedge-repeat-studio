"""Native DOM/CSS state checks on static source markup, not a React app smoke."""
import json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
project = Path(__file__).resolve().parents[2]
fixtures = Path(sys.argv[1]) if len(sys.argv)>1 else project/'verification/v3/static-fixtures'
results=[]
def check(name, passed, detail=None):
    results.append({'name':name,'passed':bool(passed),'detail':detail})
    print(('PASS ' if passed else 'FAIL ')+name, flush=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1480,'height':900})
    page.set_content((fixtures/'selected-1480x900.html').read_text())
    color=page.get_by_label('Background color', exact=True)
    color.fill('#345678')
    check('native color input supports the browser regression test action',color.input_value()=='#345678')
    page.get_by_label('Cell width',exact=True).focus()
    focus=page.get_by_label('Cell width',exact=True).evaluate('(e)=>getComputedStyle(e).outlineWidth')
    check('keyboard field focus has a 2px outline',focus=='2px',focus)
    delete=page.get_by_role('button',name='Delete',exact=True)
    delete.hover()
    check('delete hover communicates destructive intent',delete.evaluate('(e)=>getComputedStyle(e).color')=='rgb(162, 44, 53)')
    check('active repeat mode uses the selection accent',page.get_by_role('button',name='Straight',exact=True).evaluate('(e)=>getComputedStyle(e).color')=='rgb(40, 85, 184)')
    check('desktop settings bar is at most 52px',page.locator('.document-toolbar').bounding_box()['height']<=52)
    tokens=page.evaluate('''() => {
      const s=getComputedStyle(document.documentElement);
      return Object.fromEntries(['--text','--text-muted','--bg-panel','--bg-subtle','--border-control','--accent','--warning','--warning-soft','--danger','--danger-soft'].map(k=>[k,s.getPropertyValue(k).trim()]));
    }''')
    def luminance(c):
        v=[int(c[i:i+2],16)/255 for i in (1,3,5)]
        v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v]
        return sum(x*y for x,y in zip(v,(.2126,.7152,.0722)))
    for fg,bg,threshold in [('--text','--bg-panel',4.5),('--text-muted','--bg-subtle',4.5),('--accent','--bg-panel',4.5),('--border-control','--bg-panel',3),('--warning','--warning-soft',4.5),('--danger','--danger-soft',4.5)]:
        a,b=luminance(tokens[fg]),luminance(tokens[bg]);ratio=(max(a,b)+.05)/(min(a,b)+.05)
        check(f'{fg} on {bg} contrast >= {threshold}',ratio>=threshold,ratio)
    page.set_content((fixtures/'exporting-1480x900.html').read_text())
    opacity=page.get_by_role('button',name='Rendering PNG…').evaluate('(e)=>getComputedStyle(e).opacity')
    check('processing primary action retains 80% opacity',opacity=='0.8',opacity)
    page.set_viewport_size({'width':900,'height':600})
    page.set_content((fixtures/'errors-900x600.html').read_text())
    source=page.locator('.source-content')
    source.evaluate('(e)=>e.scrollTop=e.scrollHeight')
    check('valid imported sources are reachable without dismissing errors',source.evaluate('(e)=>e.scrollTop>0'))
    last=page.get_by_test_id('asset-card').last.bounding_box(); region=source.bounding_box()
    check('source scroll keeps valid assets inside their section',last['y']+last['height']<=region['y']+region['height']+1)
    page.set_viewport_size({'width':900,'height':650})
    page.set_content((fixtures/'selected-900x650.html').read_text())
    export=page.get_by_role('button',name='Export PNG',exact=True).bounding_box()
    check('export action fits the initial 900x650 selected layout',export['y']+export['height']<=650)
    browser.close()
(project/'verification/v3/style-state.json').write_text(json.dumps({'scope':'Native DOM/CSS on static source fixtures; NOT React/Konva runtime verification. Not a full accessibility audit.','results':results},indent=2))
assert all(r['passed'] for r in results)
print(f'{len(results)} state/contrast checks passed. Static/native DOM only.')
