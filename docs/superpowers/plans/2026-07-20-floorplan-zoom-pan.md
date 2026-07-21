# Floor-plan editor zoom/pan controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real camera-based zoom (+/- buttons and cursor-anchored scroll-wheel) and pan (drag empty canvas) to the floor-plan editor, replacing the current pure auto-fit-to-content view.

**Architecture:** A new optional `Camera { scale, centerX, centerY }` value lives in `ui.camera` (view-only state, not `model`, never pushed to undo/redo history). When `null`, `viewTransform()` behaves exactly as it does today (auto-fit to content bounding box). Once the user zooms/pans, `camera` becomes a real value and every render uses it directly instead of recomputing the bounding box. A "fit to screen" button clears it back to `null`.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, no backend/DB involvement at all.

**Approved design spec:** `docs/superpowers/specs/2026-07-20-floorplan-zoom-pan-design.md` — read it first; this plan implements it exactly.

---

## Before you start

Confirm you're in the right place:

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor/app/web
git branch --show-current   # expect: worktree-floorplan-editor
npx vitest run --reporter=dot 2>&1 | tail -5   # confirm a clean, fully-green baseline before touching anything
```

All file paths below are relative to `app/web/src/` unless stated otherwise. This is a purely additive frontend feature — no `db/migrations`, no `app/api` files, no new files at all. Every task modifies one of these four existing files (plus their existing test files):

- `lib/floorplan/viewTransform.ts` — the render transform (Task 1)
- `lib/floorplan/reducer.ts` — the `Camera` state + 3 new actions (Task 2)
- `components/FloorPlanEditor.tsx` — buttons, wheel handler, pan (Tasks 3-5)
- `components/FloorPlanCanvas.tsx` — **unchanged**. It only ever calls `t.px()`/`t.py()`; nothing here needs to know a camera exists.

---

### Task 1: Camera-aware `viewTransform()`

**Files:**
- Modify: `lib/floorplan/viewTransform.ts`
- Test: `lib/floorplan/viewTransform.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these three `it()` blocks inside a new nested `describe('with a camera', ...)`, after the existing `describe('viewTransform', ...)` tests in `lib/floorplan/viewTransform.test.ts` (keep the existing 3 tests untouched):

```ts
  describe('with a camera', () => {
    it('centers px/py on camera.centerX/centerY at the given scale, ignoring content bounds', () => {
      const f1 = emptyFloorGraph('A')
      addVertex(f1, 0, 0); addVertex(f1, 6, 5)
      const camera = { scale: 100, centerX: 3, centerY: 2 }
      const t = viewTransform([f1], { width: 900, height: 560, margin: 48 }, camera)
      expect(t.px(3)).toBeCloseTo(450) // width/2
      expect(t.py(2)).toBeCloseTo(280) // height/2
      expect(t.scale).toBe(100)
    })

    it('userToWorld inverts px/py under a camera', () => {
      const f1 = emptyFloorGraph('A')
      const camera = { scale: 150, centerX: 1, centerY: 1 }
      const t = viewTransform([f1], { width: 900, height: 560, margin: 48 }, camera)
      const world = t.userToWorld(t.px(4), t.py(-2))
      expect(world.x).toBeCloseTo(4)
      expect(world.y).toBeCloseTo(-2)
    })

    it('a null camera falls back to the existing auto-fit behavior exactly', () => {
      const f1 = emptyFloorGraph('A')
      addVertex(f1, 0, 0); addVertex(f1, 6, 5)
      const withoutArg = viewTransform([f1], { width: 900, height: 560, margin: 48 })
      const withNull = viewTransform([f1], { width: 900, height: 560, margin: 48 }, null)
      expect(withNull.scale).toBe(withoutArg.scale)
      expect(withNull.px(3)).toBe(withoutArg.px(3))
      expect(withNull.py(2)).toBe(withoutArg.py(2))
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/floorplan/viewTransform.test.ts`
Expected: FAIL — `viewTransform` doesn't accept a third argument yet, so `camera` is `undefined` and the new assertions don't match the auto-fit math.

- [ ] **Step 3: Implement the camera-aware transform**

Replace the full contents of `lib/floorplan/viewTransform.ts` with:

```ts
import type { FloorGraph } from './types'

export interface Camera { scale: number; centerX: number; centerY: number }

export interface ViewTransform {
  scale: number
  px: (x: number) => number
  py: (y: number) => number
  userToWorld: (ux: number, uy: number) => { x: number; y: number }
  viewBox: string
  width: number
  height: number
}

export function viewTransform(
  floors: FloorGraph[], opts: { width: number; height: number; margin: number }, camera?: Camera | null,
): ViewTransform {
  const { width, height, margin } = opts
  if (camera) {
    const { scale, centerX, centerY } = camera
    const px = (x: number) => width / 2 + (x - centerX) * scale
    const py = (y: number) => height / 2 - (y - centerY) * scale
    const userToWorld = (ux: number, uy: number) => ({
      x: centerX + (ux - width / 2) / scale,
      y: centerY - (uy - height / 2) / scale,
    })
    return { scale, px, py, userToWorld, viewBox: `0 0 ${width} ${height}`, width, height }
  }
  const pts = floors.flatMap(f => Object.values(f.vertices).map(v => [v.x, v.y] as [number, number]))
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const minx = Math.min(...xs, 0), maxx = Math.max(...xs, 1)
  const miny = Math.min(...ys, 0), maxy = Math.max(...ys, 1)
  const spanx = maxx - minx || 1, spany = maxy - miny || 1
  const scale = Math.min((width - 2 * margin) / spanx, (height - 2 * margin) / spany)
  const px = (x: number) => margin + (x - minx) * scale
  const py = (y: number) => height - margin - (y - miny) * scale
  const userToWorld = (ux: number, uy: number) => ({
    x: (ux - margin) / scale + minx,
    y: (height - margin - uy) / scale + miny,
  })
  return { scale, px, py, userToWorld, viewBox: `0 0 ${width} ${height}`, width, height }
}
```

(The no-camera branch is byte-identical to the previous function body — only reindented under the new `if (camera)` early return.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/floorplan/viewTransform.test.ts`
Expected: PASS, all 6 tests (3 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor/app
git add web/src/lib/floorplan/viewTransform.ts web/src/lib/floorplan/viewTransform.test.ts
git commit -m "feat(web): add optional camera param to viewTransform for zoom/pan"
```

---

### Task 2: `Camera` state + `SET_CAMERA`/`ZOOM_AT`/`RESET_CAMERA` in the reducer

**Files:**
- Modify: `lib/floorplan/reducer.ts`
- Test: `lib/floorplan/reducer.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block at the end of `lib/floorplan/reducer.test.ts` (it already has a `modelWithRectangle()` helper at the top — reuse it):

```ts
describe('camera actions (view-only, never touch history)', () => {
  it('starts with no camera (auto-fit)', () => {
    const { model } = modelWithRectangle()
    expect(initialState(model).ui.camera).toBeNull()
  })

  it('SET_CAMERA sets the camera without pushing history or marking dirty', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_CAMERA', camera: { scale: 100, centerX: 2, centerY: 1 } })
    expect(s.ui.camera).toEqual({ scale: 100, centerX: 2, centerY: 1 })
    expect(s.past).toHaveLength(0)
    expect(s.dirty).toBe(false)
  })

  it('RESET_CAMERA clears the camera back to auto-fit (null)', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_CAMERA', camera: { scale: 100, centerX: 2, centerY: 1 } })
    s = reducer(s, { type: 'RESET_CAMERA' })
    expect(s.ui.camera).toBeNull()
    expect(s.past).toHaveLength(0)
  })

  it('ZOOM_AT zooms around the anchor, keeping the anchor point\'s world position fixed', () => {
    const { model } = modelWithRectangle()
    const s = reducer(initialState(model), {
      type: 'ZOOM_AT', anchor: { x: 4, y: 0 }, factor: 2, seed: { scale: 100, centerX: 0, centerY: 0 },
    })
    expect(s.ui.camera).toEqual({ scale: 200, centerX: 2, centerY: 0 })
    expect(s.past).toHaveLength(0)
    expect(s.dirty).toBe(false)
  })

  it('ZOOM_AT uses the provided seed only while camera is still null', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, {
      type: 'ZOOM_AT', anchor: { x: 0, y: 0 }, factor: 1.5, seed: { scale: 50, centerX: 0, centerY: 0 },
    })
    expect(s.ui.camera!.scale).toBe(75)
    // second zoom: camera is no longer null, so the (now-stale) seed must be ignored
    s = reducer(s, {
      type: 'ZOOM_AT', anchor: { x: 0, y: 0 }, factor: 2, seed: { scale: 999, centerX: 0, centerY: 0 },
    })
    expect(s.ui.camera!.scale).toBe(150)
  })

  it('ZOOM_AT clamps scale to sane bounds instead of zooming without limit', () => {
    const { model } = modelWithRectangle()
    const zoomedIn = reducer(initialState(model), {
      type: 'ZOOM_AT', anchor: { x: 0, y: 0 }, factor: 1e9, seed: { scale: 100, centerX: 0, centerY: 0 },
    })
    expect(zoomedIn.ui.camera!.scale).toBeLessThan(1e9)
    const zoomedOut = reducer(initialState(model), {
      type: 'ZOOM_AT', anchor: { x: 0, y: 0 }, factor: 1e-9, seed: { scale: 100, centerX: 0, centerY: 0 },
    })
    expect(zoomedOut.ui.camera!.scale).toBeGreaterThan(0)
  })

  it('SWITCH_FLOOR and ADD_FLOOR preserve the camera (view state is shared across floors, not reset)', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_CAMERA', camera: { scale: 100, centerX: 2, centerY: 1 } })
    s = reducer(s, { type: 'ADD_FLOOR' })
    expect(s.ui.camera).toEqual({ scale: 100, centerX: 2, centerY: 1 })
    s = reducer(s, { type: 'SWITCH_FLOOR', index: 0 })
    expect(s.ui.camera).toEqual({ scale: 100, centerX: 2, centerY: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/floorplan/reducer.test.ts`
Expected: FAIL — `camera` doesn't exist on `UI` yet, and `SET_CAMERA`/`ZOOM_AT`/`RESET_CAMERA` aren't valid action types.

- [ ] **Step 3: Implement the reducer changes**

In `lib/floorplan/reducer.ts`:

1. Add the import (alongside the existing `Guide` import):

```ts
import type { Guide } from './snapping'
import type { Camera } from './viewTransform'
```

2. Add `camera` to the `UI` interface:

```ts
export interface UI {
  tool: Tool
  sel: Sel
  drag: DragState | null
  editRoom: { cx: number; cy: number } | null
  snapGuides: Guide[]
  showDims: boolean
  calibrating: boolean
  camera: Camera | null
}
```

3. Add scale-clamp constants right after `const MAX_HISTORY = 50`:

```ts
const MAX_HISTORY = 50
const MIN_SCALE = 8
const MAX_SCALE = 4000
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
```

4. Add `camera: null` to `initialState`'s returned `ui` object:

```ts
export function initialState(model: FloorPlanModel): EditorState {
  return {
    model,
    ui: {
      tool: 'select', sel: null, drag: null, editRoom: null, snapGuides: [], showDims: true,
      calibrating: false, camera: null,
    },
    dirty: false,
    past: [], future: [],
    dragBase: null,
  }
}
```

5. Add the three new action types to the `Action` union (after `SET_REFERENCE_FIELD`):

```ts
  | { type: 'SET_REFERENCE_FIELD'; key: 'opacity' | 'scale_m_per_px'; value: number }
  | { type: 'SET_CAMERA'; camera: Camera }
  | { type: 'ZOOM_AT'; anchor: { x: number; y: number }; factor: number; seed: Camera }
  | { type: 'RESET_CAMERA' }
  | { type: 'DELETE_SEL' }
```

6. Add the three cases to the `reducer` switch (next to `case 'SET_CALIBRATING':`):

```ts
    case 'SET_CALIBRATING': return uiChange(s, { calibrating: a.on })
    case 'SET_CAMERA': return uiChange(s, { camera: a.camera })
    case 'RESET_CAMERA': return uiChange(s, { camera: null })
    case 'ZOOM_AT': {
      const cam = s.ui.camera ?? a.seed
      const newScale = clampScale(cam.scale * a.factor)
      const centerX = a.anchor.x + (cam.centerX - a.anchor.x) * (cam.scale / newScale)
      const centerY = a.anchor.y + (cam.centerY - a.anchor.y) * (cam.scale / newScale)
      return uiChange(s, { camera: { scale: newScale, centerX, centerY } })
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/floorplan/reducer.test.ts`
Expected: PASS, all tests including the 7 new ones.

- [ ] **Step 5: Run the full frontend suite to confirm no other test regressed**

Run: `npx vitest run`
Expected: PASS, same total count as baseline + 7.

- [ ] **Step 6: Commit**

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor/app
git add web/src/lib/floorplan/reducer.ts web/src/lib/floorplan/reducer.test.ts
git commit -m "feat(web): add camera state + SET_CAMERA/ZOOM_AT/RESET_CAMERA actions"
```

---

### Task 3: Zoom (+/-) and fit buttons in `FloorPlanEditor`

**Files:**
- Modify: `components/FloorPlanEditor.tsx`
- Test: `components/FloorPlanEditor.interaction.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block at the end of `components/FloorPlanEditor.interaction.test.tsx`:

```tsx
describe('zoom buttons', () => {
  it('clicking + zooms in around the canvas center, pushing off-center vertices farther from center on screen', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const vertexHandle = container.querySelectorAll('[data-el="vertex"]')[0] // (0,0) -- far from canvas center
    const beforeCx = Number(vertexHandle.getAttribute('cx'))
    fireEvent.click(container.querySelector('[aria-label="Zoom in"]')!)
    const afterCx = Number(container.querySelectorAll('[data-el="vertex"]')[0].getAttribute('cx'))
    expect(Math.abs(afterCx - 450)).toBeGreaterThan(Math.abs(beforeCx - 450)) // 450 = W/2
  })

  it('clicking - zooms out, pulling vertices closer to the canvas center', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const vertexHandle = container.querySelectorAll('[data-el="vertex"]')[0]
    const beforeCx = Number(vertexHandle.getAttribute('cx'))
    fireEvent.click(container.querySelector('[aria-label="Zoom out"]')!)
    const afterCx = Number(container.querySelectorAll('[data-el="vertex"]')[0].getAttribute('cx'))
    expect(Math.abs(afterCx - 450)).toBeLessThan(Math.abs(beforeCx - 450))
  })

  it('the fit button restores the original auto-fit view after zooming', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const vertexHandle = container.querySelectorAll('[data-el="vertex"]')[0]
    const beforeCx = vertexHandle.getAttribute('cx'), beforeCy = vertexHandle.getAttribute('cy')
    fireEvent.click(container.querySelector('[aria-label="Zoom in"]')!)
    fireEvent.click(container.querySelector('[aria-label="Zoom in"]')!)
    fireEvent.click(container.querySelector('[aria-label="Fit to screen"]')!)
    const after = container.querySelectorAll('[data-el="vertex"]')[0]
    expect(after.getAttribute('cx')).toBe(beforeCx)
    expect(after.getAttribute('cy')).toBe(beforeCy)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/FloorPlanEditor.interaction.test.tsx -t "zoom buttons"`
Expected: FAIL — no `[aria-label="Zoom in"]` etc. exist yet.

- [ ] **Step 3: Implement the buttons**

In `components/FloorPlanEditor.tsx`:

1. Change the viewTransform import to also bring in the `Camera` type:

```ts
import { viewTransform, type Camera } from '../lib/floorplan/viewTransform'
```

2. Add a zoom step constant next to the existing `MIN_CAL_PX`:

```ts
const W = 900, H = 560, MARGIN = 48
const TOOLS: Tool[] = ['select', 'wall', 'door', 'window', 'delete']
const MIN_CAL_PX = 1e-6
const ZOOM_STEP = 1.25
```

3. Update the `t` memo to use `ui.camera` (was: `useMemo(() => viewTransform(model.floors, { width: W, height: H, margin: MARGIN }), [model.floors])`):

```ts
  const t = useMemo(
    () => viewTransform(model.floors, { width: W, height: H, margin: MARGIN }, ui.camera),
    [model.floors, ui.camera],
  )
```

4. Add `seedCamera`/`onZoomButton` right after that `t` declaration (before `const rooms = ...`):

```ts
  /** The camera to zoom FROM: the live camera if the user has already taken manual control,
   * or a value seeded from the current auto-fit view otherwise -- the reducer has no access
   * to the live viewTransform calculation, only this component does. */
  function seedCamera(): Camera {
    const c = t.userToWorld(W / 2, H / 2)
    return { scale: t.scale, centerX: c.x, centerY: c.y }
  }
  function onZoomButton(dir: 1 | -1) {
    const seed = seedCamera()
    dispatch({ type: 'ZOOM_AT', anchor: { x: seed.centerX, y: seed.centerY }, factor: dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, seed })
  }
```

5. Give the canvas wrapper `position: relative` and add the button cluster (in the JSX near the end of the component):

```tsx
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <FloorPlanCanvas
            ref={svgRef} model={model} floor={floor} t={t} rooms={rooms} angles={angles} ui={ui} editName={editName}
            imgNatural={imgNatural} calDraft={calDraft}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onMouseDown={onMouseDown}
            onRoomCommit={onRoomCommit} onRoomCancel={onRoomCancel}
          />
          <div style={{ position: 'absolute', bottom: '12px', right: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button aria-label="Zoom in" onClick={() => onZoomButton(1)} style={{ ...btn(false), padding: '4px 10px', fontSize: '14px' }}>+</button>
            <button aria-label="Fit to screen" onClick={() => dispatch({ type: 'RESET_CAMERA' })} style={{ ...btn(false), padding: '4px 10px', fontSize: '11px' }}>⤢</button>
            <button aria-label="Zoom out" onClick={() => onZoomButton(-1)} style={{ ...btn(false), padding: '4px 10px', fontSize: '14px' }}>−</button>
          </div>
        </div>
        <FloorPlanPanel model={model} floor={floor} rooms={rooms} geoJson={geoJson} ui={ui} dispatch={dispatch} />
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/FloorPlanEditor.interaction.test.tsx`
Expected: PASS, all tests including the 3 new ones. Also re-run the other two editor test files to confirm nothing regressed: `npx vitest run src/components/FloorPlanEditor.test.tsx src/components/FloorPlanEditor.calibrate.test.tsx`.

- [ ] **Step 5: Commit**

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor/app
git add web/src/components/FloorPlanEditor.tsx web/src/components/FloorPlanEditor.interaction.test.tsx
git commit -m "feat(web): add +/- zoom and fit-to-screen buttons to the floor-plan editor"
```

---

### Task 4: Cursor-anchored scroll-wheel zoom

**Files:**
- Modify: `components/FloorPlanEditor.tsx`
- Test: `components/FloorPlanEditor.interaction.test.tsx`

React's synthetic `onWheel` handler cannot call `preventDefault()` — React attaches wheel/touch listeners passively at the root for scroll performance, so a JSX `onWheel` prop would log a console warning and fail to stop the page from scrolling. This step uses a real `addEventListener('wheel', ..., { passive: false })` in a `useEffect` instead, which `preventDefault()` can actually block.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `components/FloorPlanEditor.interaction.test.tsx`:

```tsx
describe('scroll-wheel zoom', () => {
  it('scrolling up over a vertex zooms in anchored at the cursor, keeping that vertex fixed on screen', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const anchorPos = pointerAt(model.floors, 0, 0) // vertex a=(0,0)'s own screen position
    const before = svg.querySelectorAll('[data-el="vertex"]')
    const beforeAnchorCx = before[0].getAttribute('cx'), beforeAnchorCy = before[0].getAttribute('cy')
    const beforeFarCx = Number(before[2].getAttribute('cx')) // vertex c=(6,4), far from the anchor
    fireEvent.wheel(svg, { ...anchorPos, deltaY: -100 })
    const after = svg.querySelectorAll('[data-el="vertex"]')
    expect(Number(after[0].getAttribute('cx'))).toBeCloseTo(Number(beforeAnchorCx))
    expect(Number(after[0].getAttribute('cy'))).toBeCloseTo(Number(beforeAnchorCy))
    expect(Number(after[2].getAttribute('cx'))).toBeGreaterThan(beforeFarCx) // scale increased, far corner pushed further away
  })

  it('scrolling down zooms out', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const beforeFarCx = Number(svg.querySelectorAll('[data-el="vertex"]')[2].getAttribute('cx'))
    fireEvent.wheel(svg, { ...pointerAt(model.floors, 0, 0), deltaY: 100 })
    const afterFarCx = Number(svg.querySelectorAll('[data-el="vertex"]')[2].getAttribute('cx'))
    expect(afterFarCx).toBeLessThan(beforeFarCx)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/FloorPlanEditor.interaction.test.tsx -t "scroll-wheel zoom"`
Expected: FAIL — no wheel handling exists yet, so nothing changes on `fireEvent.wheel`.

- [ ] **Step 3: Implement the wheel handler**

In `components/FloorPlanEditor.tsx`:

1. Add the step constant next to `ZOOM_STEP`:

```ts
const ZOOM_STEP = 1.25
const WHEEL_ZOOM_STEP = 1.08
```

2. Add a `useEffect` right after the `pointerToWorld` function definition (which is defined further down the component, after `t`/`seedCamera`):

```ts
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const anchor = pointerToWorld(e)
      const seed = seedCamera()
      const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
      dispatch({ type: 'ZOOM_AT', anchor, factor, seed })
    }
    svg.addEventListener('wheel', onWheelNative, { passive: false })
    return () => svg.removeEventListener('wheel', onWheelNative)
  }, [t])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/FloorPlanEditor.interaction.test.tsx`
Expected: PASS, all tests including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor/app
git add web/src/components/FloorPlanEditor.tsx web/src/components/FloorPlanEditor.interaction.test.tsx
git commit -m "feat(web): add cursor-anchored scroll-wheel zoom to the floor-plan editor"
```

---

### Task 5: Pan via drag on empty canvas

**Files:**
- Modify: `components/FloorPlanEditor.tsx`
- Test: `components/FloorPlanEditor.interaction.test.tsx`

- [ ] **Step 1: Pure refactor — split `pointerToWorld` into `pointerToUser` + `pointerToWorld`, run existing tests to confirm zero behavior change**

Replace the current `pointerToWorld` function in `components/FloorPlanEditor.tsx`:

```ts
  const pointerToWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null
    if (ctm) {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY
      const u = p.matrixTransform(ctm.inverse())
      return t.userToWorld(u.x, u.y)
    }
    const rect = svg.getBoundingClientRect()
    const sx = rect.width ? (e.clientX - rect.left) * (W / rect.width) : e.clientX - rect.left
    const sy = rect.height ? (e.clientY - rect.top) * (H / rect.height) : e.clientY - rect.top
    return t.userToWorld(sx, sy)
  }
```

with:

```ts
  /** Screen client coords -> SVG user-space (viewBox) coords, independent of the camera --
   * the pre-userToWorld half of pointerToWorld, split out so pan-drag can diff two
   * user-space points using the FIXED start-of-gesture camera instead of the live one
   * (which is being updated every frame of the pan itself). */
  const pointerToUser = (e: { clientX: number; clientY: number }): { ux: number; uy: number } => {
    const svg = svgRef.current
    if (!svg) return { ux: 0, uy: 0 }
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null
    if (ctm) {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY
      const u = p.matrixTransform(ctm.inverse())
      return { ux: u.x, uy: u.y }
    }
    const rect = svg.getBoundingClientRect()
    const sx = rect.width ? (e.clientX - rect.left) * (W / rect.width) : e.clientX - rect.left
    const sy = rect.height ? (e.clientY - rect.top) * (H / rect.height) : e.clientY - rect.top
    return { ux: sx, uy: sy }
  }

  const pointerToWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const { ux, uy } = pointerToUser(e)
    return t.userToWorld(ux, uy)
  }
```

Run: `npx vitest run src/components/FloorPlanEditor.test.tsx src/components/FloorPlanEditor.calibrate.test.tsx src/components/FloorPlanEditor.interaction.test.tsx`
Expected: PASS — every existing test (drag, calibration, undo/redo, T-junction, zoom, wheel) still green. This step changes zero behavior; it only exposes the intermediate value.

- [ ] **Step 2: Write the failing pan tests**

Add this `describe` block to `components/FloorPlanEditor.interaction.test.tsx`:

```tsx
describe('pan via drag on empty canvas', () => {
  it('clicking empty canvas with no movement still clears the selection', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelectorAll('[data-el="vertex"]')[0]
    fireEvent.pointerDown(vertexHandle, pointerAt(model.floors, 0, 0))
    fireEvent.pointerUp(svg)
    expect(svg.querySelectorAll('[data-el="vertex"]')[0].getAttribute('r')).toBe('6') // selected
    // (850, 30) is well outside the model's auto-fit bounding box (screen x:[48,744], y:[48,512]
    // for this model), so it hits no vertex/edge/room element -- truly empty canvas.
    fireEvent.pointerDown(svg, { clientX: 850, clientY: 30 })
    fireEvent.pointerUp(svg)
    expect(svg.querySelectorAll('[data-el="vertex"]')[0].getAttribute('r')).toBe('4.5') // deselected
  })

  it('dragging on empty canvas pans the view instead of clearing the selection', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelectorAll('[data-el="vertex"]')[0]
    fireEvent.pointerDown(vertexHandle, pointerAt(model.floors, 0, 0))
    fireEvent.pointerUp(svg)
    const beforeCx = Number(vertexHandle.getAttribute('cx'))
    fireEvent.pointerDown(svg, { clientX: 850, clientY: 30 })
    fireEvent.pointerMove(svg, { clientX: 800, clientY: 80 })
    fireEvent.pointerUp(svg)
    const after = svg.querySelectorAll('[data-el="vertex"]')[0]
    expect(Number(after.getAttribute('cx'))).not.toBe(beforeCx) // the view panned
    expect(after.getAttribute('r')).toBe('6') // selection preserved, NOT cleared by the drag
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/FloorPlanEditor.interaction.test.tsx -t "pan via drag"`
Expected: FAIL — background clicks still clear selection unconditionally today (that part passes), but dragging on empty canvas currently does nothing at all, so the pan test's `not.toBe(beforeCx)` assertion fails (position unchanged).

- [ ] **Step 4: Implement pan**

In `components/FloorPlanEditor.tsx`:

1. Add the pan refs and threshold constant, next to the existing `dragMovedRef`:

```ts
  const dragMovedRef = useRef(false)
  const panRef = useRef<{ startUx: number; startUy: number; camera: Camera } | null>(null)
  const panMovedRef = useRef(false)
```

```ts
const ZOOM_STEP = 1.25
const WHEEL_ZOOM_STEP = 1.08
const PAN_DRAG_THRESHOLD = 4 // SVG user-space px before a background press counts as a pan, not a click
```

2. In `onPointerDown`, replace the final background-click branch:

```ts
    } else {
      dispatch({ type: 'SET_SEL', sel: null }); dispatch({ type: 'SET_DRAG', drag: null })
    }
```

with:

```ts
    } else {
      const { ux, uy } = pointerToUser(e)
      const centerWorld = t.userToWorld(W / 2, H / 2)
      panRef.current = { startUx: ux, startUy: uy, camera: { scale: t.scale, centerX: centerWorld.x, centerY: centerWorld.y } }
      panMovedRef.current = false
    }
```

(Selection is now cleared on release rather than on press, ONLY if the press turns out to be a plain click with no movement -- see `onPointerUp` below. A real click still releases within the same event-loop tick a user perceives as instantaneous, so this isn't user-visible; it's what lets a background click be told apart from a background drag.)

3. In `onPointerMove`, insert a pan-handling branch right after the `calibrating` early-return block and before `const drag = ui.drag`:

```ts
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (ui.calibrating) {
      if (!calDragRef.current) return
      const p = pointerToWorld(e)
      setCalDraft(d => d ? { p0: d.p0, p1: [p.x, p.y] } : d)
      return
    }
    if (panRef.current) {
      const { ux, uy } = pointerToUser(e)
      const dxUser = ux - panRef.current.startUx, dyUser = uy - panRef.current.startUy
      if (Math.abs(dxUser) > PAN_DRAG_THRESHOLD || Math.abs(dyUser) > PAN_DRAG_THRESHOLD) panMovedRef.current = true
      if (panMovedRef.current) {
        const { scale, centerX, centerY } = panRef.current.camera
        dispatch({ type: 'SET_CAMERA', camera: { scale, centerX: centerX - dxUser / scale, centerY: centerY + dyUser / scale } })
      }
      return
    }
    const drag = ui.drag
    if (!drag) return
    // ...rest of the function is unchanged...
```

4. In `onPointerUp`, insert a pan-finalizing branch right after the `calibrating` early-return and before `const drag = ui.drag`:

```ts
  const onPointerUp = () => {
    if (ui.calibrating) { calDragRef.current = false; return }
    if (panRef.current) {
      if (!panMovedRef.current) { dispatch({ type: 'SET_SEL', sel: null }); dispatch({ type: 'SET_DRAG', drag: null }) }
      panRef.current = null
      return
    }
    const drag = ui.drag
    if (!drag) return
    // ...rest of the function is unchanged...
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/FloorPlanEditor.interaction.test.tsx`
Expected: PASS, all tests including the 2 new pan tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor/app
git add web/src/components/FloorPlanEditor.tsx web/src/components/FloorPlanEditor.interaction.test.tsx
git commit -m "feat(web): add pan-via-drag-empty-canvas to the floor-plan editor"
```

---

### Task 6: Full verification suite

**Files:** none (verification only)

- [ ] **Step 1: Backend suite — confirm untouched (no backend files were modified in this plan)**

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor/app
set -a && source ../.env && set +a
PYTHONPATH=.:.. pytest api/tests/ -q
```
Expected: same pass count as the pre-existing baseline (231, per the last confirmed count), 0 failures.

- [ ] **Step 2: Full frontend suite**

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor/app/web
npx vitest run
```
Expected: all files green, 0 failures. Test count = previous baseline (101) + 17 new: 3 from Task 1 (viewTransform), 7 from Task 2 (reducer, including the floor-switch persistence test), 3 from Task 3 (zoom buttons), 2 from Task 4 (wheel), 2 from Task 5 (pan) = 118 total.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Production build**

```bash
npm run build
```
Expected: build succeeds. Clean up afterward: `rm -rf dist`.

- [ ] **Step 5: Confirm no stray build artifacts**

```bash
cd /Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor
git status --short | grep -E '\.js$|\.js\.map$' | grep -v node_modules
```
Expected: no output (the `app/web/.gitignore` added by the previous feature already covers this).

---

### Task 7: Manual browser E2E smoke test (mandatory — do not skip)

This project's standing rule is that UI changes are verified live in a real browser before being called done, not just via unit tests. Restart the dev servers if they aren't already running against this code (see prior session notes: uvicorn needs `--reload` and vite needs `--port 5184 --host 127.0.0.1`).

- [ ] Open a project or prospect's PLANO tab with an existing multi-wall floor plan (or draw a quick rectangle if none exists).
- [ ] Click `+` several times: confirm the plan visibly zooms in around the canvas center (walls get bigger, common center point stays put).
- [ ] Click `−` several times: confirm it zooms back out, and can go further out than the original auto-fit (more empty canvas around the plan).
- [ ] Scroll the mouse wheel with the cursor positioned over a specific corner of the plan: confirm that corner stays fixed under the cursor while everything else moves relative to it (the hallmark of cursor-anchored zoom, distinct from the buttons' center-anchored zoom).
- [ ] Click-and-drag on empty canvas space (not on a wall/vertex/room): confirm the view pans smoothly, following the cursor.
- [ ] Click on a wall or vertex to select it, then drag on empty canvas: confirm the selection is NOT cleared by the pan (still highlighted after releasing).
- [ ] Click on empty canvas with no drag (a plain click): confirm the selection IS cleared, exactly as before this feature existed.
- [ ] Click the fit/center button: confirm the view snaps back to showing the entire plan.
- [ ] If the project/prospect has more than one floor: zoom/pan to a specific spot, switch floors, and confirm the same zoom/pan is retained on the new floor (per the design's decision that camera state is shared, not per-floor).
- [ ] Place or move a wall while zoomed in: confirm dragging still works correctly at non-1:1 zoom levels (i.e., the drag math isn't secretly assuming auto-fit scale).
- [ ] Click GUARDAR, reload the page: confirm the saved geometry is unaffected by whatever camera state was active (walls/rooms exactly as saved) and the view resets to auto-fit on reload (camera is not persisted, as designed).
- [ ] Report the outcome of each check above before considering this plan done. If anything fails, fix it and re-run the specific failing check — do not mark the task complete on a partial pass.

---

## Verification summary

Nothing in this plan is "done" without: (a) the full pytest suite still green (untouched, since no backend file changes), (b) the full vitest suite green including every new test added across Tasks 1-5, (c) `tsc --noEmit` clean, (d) a production build succeeding, and (e) the manual browser walkthrough in Task 7 actually performed and reported, not skipped. Do not commit/push/deploy beyond the per-task local commits above without the user's explicit separate go-ahead — this plan ends at local verification, matching how the two previous features in this repo (PR #4, PR #5) were only pushed after the user confirmed each time.
