# Selvedge Repeat — v4

A one-screen, local desktop-browser compositor for finished PNGs. Vite, React, TypeScript, Konva/react-konva, plain CSS, and Vitest. No backend, account, persistence, or external runtime service.

**Delivery status:** v4 fixes six P2 interaction/correctness findings identified against the supplied v3 codebase. It preserves the v3 visual design and v2 camera-recovery algorithms. `REVIEW-v4.md` contains the findings, corrections, adversarial second-pass review, and evidence boundaries. **npm installation remains blocked: no generated `package-lock.json`, installed dependency tree, or production build is included.** The normal typecheck/build/Vitest/Playwright commands were attempted but did not complete successfully. Supplemental checks are not substitutes for those commands.

## What's changed in v4

| Finding | Correction |
| --- | --- |
| Demo loading could finish inside another edit and consume its undo baseline. | Recheck operation state after decoding. Keep session assets, but defer insertion with an inline explanation. Reject unrelated commits and wrong-copy gesture callbacks during a pinned edit. |
| Wheel zoom during Space-pan was overwritten by the next pointer move. | Apply pointer deltas and pointer-centered zoom to the synchronous current camera. Cancel interrupted pointer sessions; preserve normal copy-budget preflight. |
| Accepted native colors could remain uncommitted until a later blur; stale settings callbacks could overwrite newer transforms. | Commit native picker acceptance, retain blur fallback, and merge typed settings patches into the latest document. Rejected/disabled accepts restore the committed color. |
| Native thumbnail or URL drops could invoke browser defaults outside the importer. | Make both thumbnail lists non-draggable and cancel app-wide drop defaults, while routing actual files to the existing batch importer. |
| A failed download initiation could publish a new successful-looking proof. | Publish the new export only after download initiation returns successfully. Retain the previous proof on failure and allow retry. |
| Releasing one key in an arrow-key chord split a continuous nudge into multiple undo entries. | Track held arrow keys and end the gesture only on the final tracked release, blur, or another explicit edit boundary. |

No additional editor feature, service, dependency, or styling system is introduced. The neutral canvas-first layout, inspector, export verification, and 900px desktop layout remain unchanged. `DESIGN-CHANGES-v3.md` is retained as the historical 61-item design checklist. The shell has a 900px minimum width and 540px minimum height; smaller windows and a mobile interface are outside scope.

## Install and run

Use **Node.js 22.12.0 or newer** and npm. `.nvmrc` selects Node 22.

From this directory:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The dev server is explicitly bound to loopback, uses port 5173, and refuses to silently switch ports. The first installation needs npm registry access; the running app does not need internet access. `npm install` will generate `package-lock.json` (generation was blocked in the delivery environment; an incomplete lockfile has not been fabricated).

Exact validation/build commands:

```sh
npm run typecheck
npm run test
npm run build
```

`typecheck` runs `tsc --noEmit`. `test` runs `vitest run`, not watch mode. `build` runs `vite build` and writes `dist/`.

For the Chromium browser suite, stop the ordinary dev server first, then:

```sh
npx playwright install chromium
npm run test:browser
```

The suite starts its own loopback Vite server in `smoke` mode and uses one Chromium worker. A system Chromium installation can instead be selected, for example on Linux:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

The smoke-only inspection bridge is configured out of normal production mode. It supplies state observations and reference-render fixtures. Authored editing tests use mouse/keyboard input; focused native-event and failure-injection cases also dispatch DOM events or patch the download boundary. These live-app tests were not executed successfully here.

## Use

Add finished PNGs with the batch picker, the asset-tray drop zone, or a drop anywhere in the app. Native thumbnail dragging and non-file drop actions are suppressed; place sources by clicking. Every file is checked separately; rejected files have inline errors, and successfully decoded files stay in the tray. The three **Add demo** motifs are the same asymmetric, alpha-bearing PNGs used by the tests. Repeated demo additions reuse their session assets. If decoding finishes during another gesture or export, the decoded sources remain available but demo placement is deferred; finish the operation and click Demo again.

Click an asset thumbnail to add a placement centered in the current view. Its uniform scale fits both the current view and cell, without enlarging the source on insertion. Imported files retain their original PNG bytes and decoded native image; thumbnails do not replace or resample the source.

Click any visible repeat to select its underlying placement. Drag from any part of its image bounding box. Use the standard Konva Transformer corners for uniform resizing and its rotation handle for rotation. Resize flipping is disabled; the separate horizontal/vertical flip buttons mirror the image's local axes around its center. The placement list is front-to-back and can select obscured motifs. Duplicate creates an independently editable placement sharing the same source asset, offsets it by 24 model pixels on both axes, and selects it. Front/back changes placement stacking.

The default model cell is **1000 × 1000 px**. Commit width/height with Enter or by leaving the field. Dimensions must be positive whole pixels. Mode and cell changes preserve every placement transform. The background color commits on native picker acceptance, with leaving the field as a fallback; **Transparent** removes the background. Invalid commits are rejected with an inline explanation.

Scroll over the canvas to zoom around the pointer. Hold **Space** and drag to pan without moving motifs. Wheel zoom during a held pan retains its zoom on subsequent moves. A viewport resize cancels the current pan rather than restoring its old camera. **Fit** shows several repeats around the origin cell when the copy limit permits, otherwise a closer preflight-valid view. **Inspect** hides the origin-cell outline and Transformer, but not the motifs. The outline follows the lattice's fundamental parallelogram in staggered modes.

### Workspace shortcuts

Shortcuts apply when focus is in the repeat workspace, never in input, select, textarea, or editable fields. Handled shortcuts prevent their browser defaults. `Mod` means Ctrl on Windows/Linux or Cmd on macOS.

| Key | Action |
| --- | --- |
| Mod+Z / Mod+Shift+Z | Undo / redo |
| Mod+D | Duplicate and select |
| Arrow / Shift+Arrow | Move selected placement by 1 / 10 model pixels |
| Delete | Delete selected placement |
| Space + drag | Pan the camera |

A pointer gesture or held-arrow nudge records one committed snapshot, not one per frame. Holding more than one arrow key keeps the same nudge open until the last tracked key is released. Blur or starting another edit also finishes it. History retains 50 prior snapshots. New committed edits clear redo. Assets, camera, and selection are outside document history; deleting/undoing a placement never removes its source asset. Stale selections are cleared.

**Refresh or closing the tab loses all work.** Session assets are released when the app unmounts. There is no save, storage, or restore facility.

## Geometry, limits, and export

Placements store image-center `x/y`, positive uniform `s`, rotation in degrees, and two flip flags. Copies are derived, not document records. A node's position is already in model-parent coordinates: copy editing subtracts its lattice translation and never inverts the camera a second time. The active `(placement, i, j)` node is pinned throughout the gesture. There is no modulo normalization or automatic recentering.

| Mode | Lattice a | Lattice b | PNG rectangle from (0,0) |
| --- | --- | --- | --- |
| Straight | (W, 0) | (0, H) | W × H |
| Half-drop (50%) | (W, H/2) | (0, H) | 2W × H |
| Brick (50%) | (W, 0) | (W/2, H) | W × 2H |

Input and output images are limited to **4096 pixels per side**. Half-drop therefore limits W to 2048; Brick limits H to 2048. Odd cell dimensions retain exact half-pixel stagger offsets. Zoom is bounded to **2%–800%**.

The pure enumerator uses the viewport and each transformed image's bounds, including negative positions, rotation, oversized images, and corner intersections. Analytic parity-run counts are checked before copy loops or Konva allocation. At most **2000 motif copies per render** are allowed, including an active pinned copy. Excess is rejected inline, never truncated. A window resize or Undo/Redo that makes the view too dense attempts bounded center-preserving zoom recovery; if no centered view fits, no partial scene is rendered, and navigation remains available to recover elsewhere. Export independently checks its whole rectangle and copy count before allocating a surface. An extremely large motif or dense cell can exceed the export limit even when a close-up live view is safe.

Stacking is placement-array order, then numeric lexicographic `(i,j)` order within each placement. Preview and export share enumeration, transforms, and native-image props. Export renders on an isolated Konva surface at **pixelRatio=1**, without camera transforms, device-pixel-ratio scaling, cell outlines, or selection handles.

**Export PNG** encodes a PNG Blob, decodes it to verify its requested dimensions, and downloads that Blob. The proof decodes the **same Blob** into a fixed **576 × 432** tiled canvas; it does not re-render the live scene or allocate a giant tiled bitmap. The proof receives an **Out of date** badge when the document changes. A new export hides the previous canvas until that exact new Blob has decoded successfully; decode failures never show a verification check. Concurrent proof decodes are canceled before drawing stale results. Scales greater than 1 are flagged because they enlarge source pixels. Encoding, decoding, allocation, and download-path exceptions are reported inline; temporary Konva nodes, canvases, bitmaps, and download URLs are disposed without revoking session asset URLs.

**Use Basic/Straight repeat elsewhere; staggering is baked in.**

Output is pixel-only browser-canvas PNG. There are no DPI/CMYK controls or production-color guarantees.

## Source layout

`src/core/geometry.ts` contains lattice bases, transformed bounds, analytic preflight, and enumeration. `transforms.ts` contains camera conversions, shared image props, and copy-to-placement mapping. `camera.ts` implements count-aware recovery/navigation without allocating copies. `history.ts` is the snapshot reducer. `png.ts`, `export.ts`, and `proof.ts` separate import, isolated export, and decoded proof handling. `useStudio.ts` coordinates session assets and document/camera gestures.

`App.tsx` owns view-only Inspect state and routes the existing studio handlers. `CellControls`, `AssetTray`, `SelectionToolbar`, `Workspace`, `Inspector`, `OutputPanel`, and `ProofPanel` have distinct UI responsibilities. `src/ui/presentation.ts` holds small pure presentation helpers and shared canvas colors. Styling remains plain `src/styles.css`; no UI kit, router, state library, or additional runtime dependency was added.

## Tests and actual verification results

There are **99 authored Vitest cases**, including the existing 87 geometry/history/camera/PNG/presentation cases and 12 new literal keyboard-delta, chord-release, and repeat-boundary cases. There are **34 authored Playwright tests**, including 11 new P2 regressions in `e2e/p2-regressions.spec.ts`. The existing noncentral-copy gestures in all lattice modes, decoded dimensions, translucent overlap, and tiled-Blob/reference comparisons remain in the suite. **The Vitest and live-app Playwright suites were not successfully executed here.**

### Commands actually attempted for v4

Environment: Node **22.16.0**, npm **10.9.2**. Supplemental compilation uses the environment's TypeScript **5.8.3**, not the uninstalled pinned 5.9.3 dependency.

| Command/check | Observed v4 result |
| --- | --- |
| `npm install --fetch-retries=0 --fetch-timeout=1000 --no-audit --no-fund` | Stopped by a 20-second process timeout without dependencies or lockfile. |
| `npm ping --fetch-retries=0 --fetch-timeout=5000` | Failed: registry DNS `EAI_AGAIN`. |
| `npm run typecheck` | Failed: dependency-provided `node` and `vite/client` types unavailable. |
| `npm run build` | Failed: `vite` unavailable. |
| `npm run test` | Failed: `vitest` unavailable. |
| `npm run test:browser` | Failed: installed environment CLI rejects `test`; the project JavaScript Playwright dependency is unavailable. |
| Supplemental isolated strict typecheck | Passed for core model/geometry/camera/history/document and pure UI helpers. Not full app typechecking. |
| Supplemental pure Node assertion replay | **99 passed, 0 failed**; transpiled test bodies, not Vitest. |
| Targeted interaction-boundary checks | **26 passed, 0 failed** using actual source functions with mocked React/Konva/import/encode/download boundaries. Not live React/Konva. |
| V3 baseline reproduction | **8 expected invariant failures** across the six P2 categories; retained as before-fix evidence, not v4 failures. |
| Existing component source/handler checks | **22 passed, 0 failed**; hook/JSX capture adapter with effects suppressed. |
| TS/TSX syntax transpilation | **38 files, zero syntax errors**; not dependency-level semantic typechecking. |
| In-memory Chromium static layout audit | **15 fixtures, 120 assertions passed**; current JSX/CSS projected to static DOM/SVG, not the live app. |
| In-memory Chromium static/native state audit | **16 checks passed**, including focus/hover, contrast pairs, scroll reachability, and native `img.draggable === false`. |
| Baseline SHA-256 comparison | **31 existing source/test/asset files unchanged**, including CSS, geometry, camera recovery, transforms, history reducer, export/proof/import algorithms, and all pre-existing tests. |

Current logs, scripts, diff, and static fixture screenshots are under `verification/v4/`. Earlier review documents and `verification/v1/`, `v2/`, and `v3/` are historical records, not new v4 executions.

### Supplemental audit reproduction

The ordinary validation path remains the npm commands above. The optional scripts below use a local TypeScript installation or an explicitly supplied `TYPESCRIPT_PATH`; they are not app dependencies or replacement test runners. These paths are the actual delivery-environment paths:

```sh
TYPESCRIPT_PATH=/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript node verification/v4/replay-core.mjs
TYPESCRIPT_PATH=/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript node verification/v4/interaction-check.mjs
TYPESCRIPT_PATH=/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript node verification/v4/component-check.mjs
TYPESCRIPT_PATH=/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript node verification/v4/syntax-check.mjs
TYPESCRIPT_PATH=/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript node verification/v4/source-harness.mjs /mnt/data/v4-ui-fixtures
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium python verification/v4/layout-audit.py /mnt/data/v4-ui-fixtures
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium python verification/v4/style-state-audit.py /mnt/data/v4-ui-fixtures
```

The static audits require Python Playwright and Chromium. Their screenshots use source-generated markup and a static SVG scene, not Konva. The interaction harness executes source functions and explicit effect flushes but mocks runtime boundaries; it does not reproduce React scheduling, browser-native picker UI, or Konva event dispatch.

To replay before-fix invariants, extract the supplied v3 ZIP separately and pass its codebase directory to `node verification/v4/interaction-check.mjs <v3-directory> --baseline`. This audit intentionally reports the expected baseline failures; it does not fail the shell command for those expected findings.

**Still unverified:** installed pinned-dependency compatibility; full app semantic typecheck/build; live React effects, native picker acceptance on real operating-system dialogs, and Konva gesture integration; compositor PNG dimensions, stacking, translucent overlap, and tiled-export/reference comparisons. The full-app browser tests cover many of these paths but were not run successfully. There is no cross-browser, screen-reader, or full accessibility-conformance claim.
