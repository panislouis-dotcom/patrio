# Floor-plan editor: zoom + pan design

## Context

The floor-plan editor's view is currently pure auto-fit: `viewTransform()`
(`app/web/src/lib/floorplan/viewTransform.ts`) recomputes a bounding box over
every vertex on every render and picks a scale that makes the whole plan
exactly fill the fixed 900x560 canvas. There is no persistent zoom or pan
state. This is why "zooming out" today means dragging walls farther apart —
a bigger bounding box forces a smaller auto-fit scale — and there is no way
to zoom in for precision work on a small area of a larger plan.

Eduardo asked for `+`/`-` zoom controls in the bottom-right of the canvas.
Through clarifying questions we established this should be a real camera
(zoom + pan), not just a zoom-out-only "expand the margin" trick, matching
the Figma/Google Maps mental model.

Confirmed via reading the code: every rendered coordinate and every pointer
event already flows through the single `ViewTransform` object (`t.px`,
`t.py`, `t.userToWorld`) — `FloorPlanCanvas.tsx` and pointer-hit-testing in
`FloorPlanEditor.tsx` never touch raw coordinates directly. This means zoom
+ pan can be added almost entirely inside `viewTransform.ts` plus a new
slice of view-only UI state, without touching hit-testing, dragging, or
snapping logic.

## Decisions (from user Q&A)

1. **Full zoom + pan**, not zoom-out-only and not zoom-without-pan. Content
   can go off-screen when zoomed in; panning is how you reach it.
2. **Pan via drag-empty-canvas only** (no scrollbars, no dedicated pan
   mode). Clicking and dragging on empty canvas space pans the view.
3. **Scroll wheel also zooms** (no modifier key required). The `+`/`-`
   buttons remain as an explicit, discoverable alternative.
4. **Zoom anchors at the cursor** for scroll-wheel zoom (the point under the
   mouse stays fixed on screen). Button clicks have no cursor reference, so
   they anchor at the canvas center.
5. **Camera persists across floor switches** (`SWITCH_FLOOR`/`ADD_FLOOR`) —
   if you're zoomed into a corner on Planta Baja and switch to Planta Alta,
   you see the same corner at the same zoom, useful for comparing aligned
   floors (matches the existing floor-ghost-overlay feature's intent).
6. **A "fit to content" reset button is included** alongside `+`/`-`, since
   with #5 there is no other way back to a full overview once you've
   wandered off zoomed in or out.

## Data model

Add to `UI` in `app/web/src/lib/floorplan/reducer.ts`:

```ts
export interface Camera { scale: number; centerX: number; centerY: number }

export interface UI {
  // ...existing fields...
  camera: Camera | null
}
```

`camera: null` means "auto-fit" — the exact behavior that exists today,
recomputed live from the current floor's bounding box on every render.
Once the user zooms, scrolls, or pans, `camera` becomes a concrete value
and the view stops auto-fitting until the user clicks "fit" again (which
sets it back to `null`).

This is **view state, not model state** — it lives in `ui` alongside
`showDims`, not in `model`. New actions are plain `uiChange`-style
reducers: they never call `modelChange`, never touch `past`/`future`, never
mark `dirty`. This mirrors the existing `SWITCH_FLOOR` comment ("choosing
which floor to view is a view action") and `TOGGLE_DIMS`. Consequences:

- Undo/redo (Ctrl+Z) never touches the camera — only edits to the plan.
- Camera state is not persisted to the saved `geometry` JSON; it resets
  every time the editor remounts (new prospect/project, or page reload).

New reducer actions:

```ts
| { type: 'SET_CAMERA'; camera: Camera }
| { type: 'ZOOM_AT'; anchor: { x: number; y: number }; factor: number; seed: Camera }
| { type: 'RESET_CAMERA' }
```

`ZOOM_AT` takes an explicit `seed` (the camera to zoom from if
`ui.camera` is currently `null`) because the reducer has no access to the
live auto-fit calculation — only the component (which already computes
`t = viewTransform(...)`) can produce that seed. `FloorPlanEditor.tsx`
resolves `ui.camera ?? { scale: t.scale, centerX: <canvas-center-world-x>,
centerY: <canvas-center-world-y> }` before dispatching.

## Zoom math

Given a `seed`/current camera `{scale, centerX, centerY}`, a `factor`
(> 1 to zoom in, < 1 to zoom out), and an `anchor` world point that should
stay fixed on screen:

```ts
const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE)
const newCenterX = anchor.x + (centerX - anchor.x) * (scale / newScale)
const newCenterY = anchor.y + (centerY - anchor.y) * (scale / newScale)
```

This is the standard "zoom to point" formula: the anchor's screen position
is invariant across the zoom operation.

- **Button click** (`+`/`-`): `anchor` = the world point currently at the
  canvas center (`t.userToWorld(W/2, H/2)` using the seed camera), `factor`
  = a fixed step (e.g. `1.25` / `1/1.25`).
- **Scroll wheel**: `anchor` = `pointerToWorld(event)` (cursor position),
  `factor` derived from `event.deltaY` (negative deltaY = scroll up = zoom
  in), clamped to a similar per-tick step so a fast trackpad fling doesn't
  jump too far in one frame.

`MIN_SCALE`/`MAX_SCALE` are absolute px-per-meter bounds (not relative to
the current auto-fit scale, since that changes as content/floors change and
the camera is meant to persist independent of it). Exact values are tuned
during implementation — target roughly 0.2x-15x the *typical* auto-fit
scale for a modest floor plan, enough to zoom into opening-placement detail
and to zoom out to lay out a large multi-wing building.

## Pan

Pan reuses the existing click-vs-drag distinction already used for vertex
drags (`dragMovedRef` in `FloorPlanEditor.tsx`): a `pointerdown` on empty
canvas (`data-el` unset, not calibrating) starts a pan candidate; if the
pointer moves past a small pixel threshold before `pointerup`, it's a pan
(camera shifts) instead of a click (which still clears selection exactly as
today, when there was no movement).

Implementation approach: on `pointerdown`, capture the raw SVG-user-space
point (the post-CTM, pre-`userToWorld` point already computed inside
`pointerToWorld`) and the camera in effect at that moment (seeded from the
live `t` if `ui.camera` was `null`). On each `pointermove`, compute the new
raw SVG-user-space point, take the delta in that *fixed, camera-independent*
space, convert to a world-space delta using the *drag-start* scale (never
the live-updating one, to avoid feedback loops), and dispatch
`SET_CAMERA` with `centerX/Y` shifted opposite the delta (content follows
the cursor).

Because pan only ever begins when `data-el` is unset, it can never conflict
with dragging a vertex/edge/opening handle or with the door/wall/delete
tools — those branches in `onPointerDown` already run first and return
before reaching the empty-canvas fallback.

## UI controls

Bottom-right of the canvas: three small square buttons (`−`, a fit/center
icon, `+`), stacked or grouped, `position: absolute` inside the canvas's
existing wrapper `<div style={{flex: 1, minWidth: 0}}>` in
`FloorPlanEditor.tsx` (needs `position: relative` added — currently has
none). Styled with the existing `btn()` helper from `floorplanStyles.ts`
for visual consistency with UNDO/REDO/Dims/Save.

- `−` / `+`: dispatch `ZOOM_AT` anchored at canvas center, as above.
- Fit/center icon: dispatch `RESET_CAMERA` (`camera` back to `null`,
  immediately falls back to the existing auto-fit render).

Scroll-wheel: an `onWheel` handler added to the `<svg>` in
`FloorPlanCanvas.tsx` (passed down as a new prop, same pattern as the
existing pointer handlers), calling `e.preventDefault()` so the page itself
doesn't scroll while the cursor is over the plan.

## Out of scope

- Pinch-to-zoom / touch gestures (no touch support exists elsewhere in the
  editor today; not introduced here).
- Persisting camera position into the saved `geometry` JSON.
- Keyboard zoom shortcuts (Cmd/Ctrl +/-).
- Per-floor independent camera (camera is one shared value across floors,
  per decision #5 above).

## Testing

- `viewTransform.test.ts`: new cases for the `camera` param — zoom-to-anchor
  math, pan offset — plus confirmation the no-camera path is byte-identical
  to today's existing tests (regression guard).
- `reducer.ts` tests: `SET_CAMERA`/`ZOOM_AT`/`RESET_CAMERA` never touch
  `past`/`future`/`dirty` (mirrors the existing `TOGGLE_DIMS`/`SWITCH_FLOOR`
  test pattern).
- `FloorPlanEditor.interaction.test.tsx`: simulated wheel-to-zoom,
  drag-to-pan (and confirming a no-movement click on empty canvas still
  clears selection, unchanged), and the three new buttons.
- Manual browser smoke test (per this project's standing rule that UI
  changes get verified live, not just unit-tested): zoom in/out via
  buttons and scroll, pan via drag, fit button recovers the full view,
  zoom/pan survives a floor switch, GUARDAR/reload still round-trips the
  plan geometry unaffected by camera state.
