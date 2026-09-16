"""Supplemental Chromium DOM/CSS audit. Static source fixtures, NOT a live app smoke."""
import json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parents[2]
fixtures = Path(sys.argv[1]) if len(sys.argv) > 1 else project / 'verification/v4/static-fixtures'
out = project / 'verification/v4/layout'
out.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'), headless=True, args=['--no-sandbox'])
    for file in sorted(fixtures.glob('*.html')):
        kind, size = file.stem.rsplit('-', 1)
        width, height = map(int, size.split('x'))
        page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1)
        page.set_content(file.read_text(), wait_until='load')
        page.screenshot(path=str(out / f'{file.stem}.png'))
        metrics = page.evaluate('''() => {
          const bounds = s => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
          const tiny = [...document.querySelectorAll('button,span,p,h1,h2,strong,small,dt,dd,label,input')].filter(e => e.checkVisibility() && parseFloat(getComputedStyle(e).fontSize) < 10).map(e=>e.outerHTML.slice(0,120));
          const controls = [...document.querySelectorAll('.app-header button,.document-toolbar button,.document-toolbar input,.canvas-toolbar button')].filter(e=>e.checkVisibility()).map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim(),rect:e.getBoundingClientRect().toJSON()}));
          const overflow = [...document.querySelectorAll('.app-header,.document-toolbar,.canvas-toolbar,.canvas-footer,.output-summary,.selection-details,.output-specs')].filter(e=>e.scrollWidth > e.clientWidth + 1).map(e=>({class:e.className,content:e.scrollWidth,available:e.clientWidth}));
          return { horizontalOverflow:document.documentElement.scrollWidth > innerWidth, verticalOverflow:document.documentElement.scrollHeight > innerHeight, header:bounds('.app-header'), settings:bounds('.document-toolbar'), canvas:bounds('.canvas-host'), tiny, overflow, controls, proof:bounds('.proof-container') };
        }''')
        checks = {
            'no_page_horizontal_overflow': not metrics['horizontalOverflow'],
            'no_page_vertical_overflow': not metrics['verticalOverflow'],
            'no_sub_10px_text': not metrics['tiny'],
            'no_toolbar_or_metadata_overflow': not metrics['overflow'],
            'header_48px': metrics['header']['height'] == 48,
            'canvas_at_least_400px_wide': metrics['canvas']['width'] >= 400,
            'proof_aspect_4_to_3': abs(metrics['proof']['width'] / metrics['proof']['height'] - 4/3) < .02,
            'controls_remain_in_view': all(c['rect']['x'] >= 0 and c['rect']['right'] <= width and c['rect']['y'] >= 0 and c['rect']['bottom'] <= height for c in metrics['controls']),
        }
        results.append({'fixture': file.stem, 'checks':checks,'metrics':metrics})
        print(file.stem, json.dumps(checks), flush=True)
        page.close()
    browser.close()
(out / 'metrics.json').write_text(json.dumps({'scope':'Static source DOM/CSS; SVG scene stub, effects suppressed. Not React/Konva runtime verification.', 'results':results}, indent=2))
assert all(all(r['checks'].values()) for r in results), 'Layout audit found failures; see metrics.json.'
print(f'{len(results)} fixtures, {sum(len(r["checks"]) for r in results)} assertions passed. Static DOM/CSS only.')
