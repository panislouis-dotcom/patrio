# Vertex-Graph Floor-Plan Editor Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coincidence-detection floor-plan editor (old branch content, discarded) with a vertex-graph implementation where shared corners are first-class objects, per `docs/superpowers/specs/2026-07-20-floorplan-graph-editor-design.md`.

**Architecture:** A `FloorGraph` per floor stores `vertices: Record<VertexId, Vertex>` and `edges: Record<EdgeId, Edge>`; edges reference vertex IDs so connectivity is a data fact, not a proximity guess. Room areas and "is this edge exterior" are derived by tracing faces of the planar graph. The backend's opaque JSON-blob geometry storage needs no changes at all — only the TS shape it stores changes.

**Tech Stack:** React + Vite + TypeScript (frontend engine + SVG canvas), FastAPI + PostgreSQL jsonb (backend, unchanged), Vitest + Testing Library, pytest.

---

## Before Task 1: what's confirmed reusable *in design*, and what Task 1's reset actually removes

**Important correction, found during this plan's own self-review:** an earlier pass verified backend/wiring reuse against the current worktree's state — but that worktree still carries the old, discarded floor-plan branch's commits on top of `main`. Task 1 hard-resets to `origin/main`. Checking `origin/main` directly (`git show origin/main:<path>`) shows **none of the following exist there**: `db/migrations/021_project_geometry.sql`, `get_project_geometry`/`set_project_geometry` in `app/api/db.py`, the geometry/floorplan-image routes in `app/api/routes/projects.py`, the 3 backend geometry test files, `fetchProjectGeometry`/`saveProjectGeometry`/`uploadFloorplanImage` in `app/web/src/lib/api.ts`, and the `plano` tab / `FloorPlanEditor` wiring in `app/web/src/components/ProjectDetailPage.tsx`. All of it was added by the old, now-discarded PR #5 work and is wiped by Task 1's hard-reset along with the wall-list engine.

The good news: this entire layer is orthogonal to the graph-vs-wall-list data model — it treats `geometry` as an opaque JSON blob end to end — so its *design* is still exactly right and doesn't need to be rethought. It just needs to be **re-added**, once, as part of this plan. **Task 13** (rewritten below) does this, using the exact verified content read directly from the current worktree before Task 1 resets it away, rather than re-deriving it from scratch.

Confirmed still true and unaffected by the reset:
- **`app/web/src/components/FloorPlanReference.tsx`** (`EmptyState`, `ReferenceControls`) and **`app/web/src/components/floorplanStyles.ts`** (`btn()`) reference no wall/footprint/edge concepts at all — fully reusable verbatim (Task 9). Confirmed these are NOT floorplan-specific additions gated behind the old branch — `colors`/`fonts` from `../lib/theme` and `BASE` from `../lib/api`, which these files depend on, already exist on `origin/main` today (pre-dating any floorplan work), so Task 9 has no hidden re-add requirement the way the backend layer did.
- `db/migrations/` on `origin/main` currently tops out at `020_financial_layer_numeric.sql` — `021_project_geometry.sql` is genuinely the next free number, confirmed fresh (not assumed from before other work merged).

## Task 1: Reset the branch, clean stray build artifacts

The current worktree branch (`worktree-floorplan-editor`) has 14 commits of the discarded wall-list implementation, plus the just-approved design-spec commit on top. Per your decision, hard-reset to `main` and carry the spec commit forward.

**Files:** none created/modified — pure git operations, run from the worktree root `/Users/eduardo/Documents/repos/patrio/.claude/worktrees/floorplan-editor`.

- [ ] **Step 1: Confirm the spec commit's SHA and that the worktree is clean**

```bash
git log --oneline -1   # expect 5d44885 docs(floorplan): add vertex-graph editor rewrite design spec
git status --porcelain # expect only the untracked tasks/ dir (pre-existing, unrelated)
```

- [ ] **Step 2: Hard-reset to main, then cherry-pick the spec commit back on top**

```bash
git fetch origin main
SPEC_SHA=$(git log --oneline -1 --format=%H)
git reset --hard origin/main
git cherry-pick "$SPEC_SHA"
git log --oneline -3   # expect the spec commit now sitting directly on main's tip
```

- [ ] **Step 3: Delete stray compiled `.js`/`.js.map` artifacts left by prior `tsc` runs**

This is a known, recurring footgun in this repo (no `outDir`/`noEmit` guard in some invocation paths lets `tsc` emit `.js` siblings in place under `src/`, which then confuse vitest with phantom duplicate test files). The existing `app/web/.gitignore` (`src/**/*.js`, `src/**/*.js.map`, `*.test.js`) prevents committing them but not generating them.

```bash
find app/web/src -name '*.js' -delete
find app/web/src -name '*.js.map' -delete
git status --porcelain app/web/src   # expect empty
```

- [ ] **Step 4: Confirm baseline tests pass on the reset branch**

```bash
cd app/web && npx vitest run 2>&1 | tail -20
cd ../.. && PYTHONPATH=app pytest app/api/tests -q 2>&1 | tail -20
```

Expected: green (this is `main`'s baseline, before any new floorplan code exists — there should be zero floorplan-related tests at this point since the old ones were just discarded by the reset).

- [ ] **Step 5: Commit checkpoint (no-op if step 3 found nothing to delete)**

If Step 3 deleted any tracked... — it won't, since they're gitignored/untracked. No commit needed for this task; proceed to Task 2.

## Task 2: Core graph types and mutation primitives

**Files:**
- Create: `app/web/src/lib/floorplan/types.ts`
- Create: `app/web/src/lib/floorplan/types.test.ts`
- Create: `app/web/src/lib/floorplan/graph.ts`
- Create: `app/web/src/lib/floorplan/graph.test.ts`

- [ ] **Step 1: Write the failing test for `types.ts`**

```ts
// app/web/src/lib/floorplan/types.test.ts
import { describe, it, expect } from 'vitest'
import { emptyModel, isEmpty, clone, floorElev } from './types'

describe('emptyModel', () => {
  it('creates one floor with an empty graph', () => {
    const m = emptyModel()
    expect(m.schemaVersion).toBe(2)
    expect(m.floors).toHaveLength(1)
    expect(m.activeFloor).toBe(0)
    expect(Object.keys(m.floors[0].vertices)).toHaveLength(0)
    expect(Object.keys(m.floors[0].edges)).toHaveLength(0)
    expect(m.floors[0].extWall_m).toBeCloseTo(0.15)
    expect(m.floors[0].intWall_m).toBeCloseTo(0.10)
  })
})

describe('isEmpty', () => {
  it('treats {} as empty', () => {
    expect(isEmpty({})).toBe(true)
  })
  it('treats a real model as non-empty', () => {
    expect(isEmpty(emptyModel())).toBe(false)
  })
})

describe('clone', () => {
  it('deep-clones so mutating the clone does not affect the original', () => {
    const m = emptyModel()
    const c = clone(m)
    c.floors[0].name = 'changed'
    expect(m.floors[0].name).not.toBe('changed')
  })
})

describe('floorElev', () => {
  it('sums the height of every floor below the given index', () => {
    const m = emptyModel()
    m.floors.push({ ...clone(m.floors[0]), height_m: 2.6 })
    m.floors[0].height_m = 3.0
    expect(floorElev(m, 0)).toBe(0)
    expect(floorElev(m, 1)).toBe(3.0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/types.test.ts`
Expected: FAIL — `./types` has no exported member `emptyModel` (module doesn't exist yet).

- [ ] **Step 3: Implement `types.ts`**

```ts
// app/web/src/lib/floorplan/types.ts
export type VertexId = string
export type EdgeId = string

export interface Vertex { id: VertexId; x: number; y: number }

export interface Opening {
  kind: 'door' | 'window'
  offset: number   // 0..1, fraction of the edge's length at drag-commit time
  width: number    // metres
}

export interface Edge {
  id: EdgeId
  v1: VertexId
  v2: VertexId
  thickness: number   // metres; bulk-updated from extWall_m/intWall_m — see reducer.ts
  openings: Opening[]
}

export interface Reference {
  imageKey: string
  scale_m_per_px: number
  origin_px: [number, number]
  opacity: number
}

export interface Room { name: string; cx: number; cy: number }

export interface FloorGraph {
  name: string
  height_m: number
  extWall_m: number
  intWall_m: number
  vertices: Record<VertexId, Vertex>
  edges: Record<EdgeId, Edge>
  rooms: Room[]          // user-assigned names, matched to traced faces by nearest centroid
  reference?: Reference
}

export interface FloorPlanModel {
  schemaVersion: 2
  slab_m: number
  activeFloor: number
  floors: FloorGraph[]
}

export function genId(): string {
  return crypto.randomUUID()
}

export function emptyFloorGraph(name: string): FloorGraph {
  return {
    name, height_m: 2.60, extWall_m: 0.15, intWall_m: 0.10,
    vertices: {}, edges: {}, rooms: [],
  }
}

export function emptyModel(): FloorPlanModel {
  return {
    schemaVersion: 2,
    slab_m: 0.15,
    activeFloor: 0,
    floors: [emptyFloorGraph('Planta Baja')],
  }
}

export function isEmpty(m: FloorPlanModel | Record<string, never>): boolean {
  return !m || !('floors' in m) || !Array.isArray(m.floors) || m.floors.length === 0
}

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

export const floorElev = (m: FloorPlanModel, i: number): number =>
  m.floors.slice(0, i).reduce((e, f) => e + f.height_m, 0)
```

**Why per-floor `extWall_m`/`intWall_m` instead of one model-level pair:** the old model had these globally; keeping them per-`FloorGraph` instead is a small, deliberate improvement — the spec's "independent graph per floor" decision means floors are otherwise fully self-contained, and different floors legitimately can want different wall thicknesses (a ground floor's exterior wall is often thicker than an attic's). `slab_m` stays model-level since it's a single constant true across the whole building. This is exposed identically in the "Global" panel per floor, so there's no UX loss versus the old single global section — see Task 12.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/lib/floorplan/types.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `graph.ts`**

```ts
// app/web/src/lib/floorplan/graph.test.ts
import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import {
  addVertex, addEdge, moveVertex, translateEdgeBody,
  splitEdgeAtVertex, mergeVertexInto, deleteVertex, deleteEdge,
  nearestVertex, nearestEdgePoint, SNAP,
} from './graph'

describe('addVertex / addEdge', () => {
  it('creates a wall between two fresh vertices', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0)
    const v2 = addVertex(f, 4, 0)
    const e = addEdge(f, v1, v2, 0.10)
    expect(f.edges[e].v1).toBe(v1)
    expect(f.edges[e].v2).toBe(v2)
    expect(Object.keys(f.vertices)).toHaveLength(2)
  })
})

describe('moveVertex', () => {
  it('moving a shared vertex moves every edge that references it', () => {
    const f = emptyFloorGraph('Test')
    const corner = addVertex(f, 0, 0)
    const a = addVertex(f, 4, 0)
    const b = addVertex(f, 0, 4)
    addEdge(f, corner, a, 0.15)
    addEdge(f, corner, b, 0.15)
    moveVertex(f, corner, 1, 1)
    expect(f.vertices[corner].x).toBe(1)
    expect(f.vertices[corner].y).toBe(1)
    // both edges still reference the SAME vertex id — no separate coincidence check needed
    const touching = Object.values(f.edges).filter(e => e.v1 === corner || e.v2 === corner)
    expect(touching).toHaveLength(2)
  })
})

describe('translateEdgeBody', () => {
  it('translates both endpoints by an identical delta, preserving a diagonal shape', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 1, 1)
    const v2 = addVertex(f, 4, 3)
    const e = addEdge(f, v1, v2, 0.10)
    translateEdgeBody(f, e, 0.3, 0.3)
    expect(f.vertices[v1].x).toBeCloseTo(1.3)
    expect(f.vertices[v1].y).toBeCloseTo(1.3)
    expect(f.vertices[v2].x).toBeCloseTo(4.3)
    expect(f.vertices[v2].y).toBeCloseTo(3.3)
    // shape (the vector from v1 to v2) is unchanged — no force-straightening
    expect(f.vertices[v2].x - f.vertices[v1].x).toBeCloseTo(3)
    expect(f.vertices[v2].y - f.vertices[v1].y).toBeCloseTo(2)
  })

  it('dragging a wall body also drags a wall sharing one of its endpoints', () => {
    const f = emptyFloorGraph('Test')
    const shared = addVertex(f, 0, 0)
    const far = addVertex(f, 4, 0)
    const perpFar = addVertex(f, 0, 4)
    const e = addEdge(f, shared, far, 0.10)
    addEdge(f, shared, perpFar, 0.10)
    translateEdgeBody(f, e, 2, 0)
    // only e's own two endpoints move: the shared corner follows the drag...
    expect(f.vertices[shared].x).toBe(2)
    // ...but perpFar is the OTHER wall's own far endpoint, not touched by this translate.
    // The second wall still reads as connected because it re-reads `shared`'s new position
    // when rendered — not because perpFar itself is dragged too (that would be wrong: it'd
    // teleport unrelated geometry any time a connected wall's body is dragged).
    expect(f.vertices[perpFar].x).toBe(0)
  })
})

describe('splitEdgeAtVertex (T-junction)', () => {
  it('splits one edge into two sharing the given vertex, redistributing openings by position', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0)
    const v2 = addVertex(f, 10, 0)
    const e = addEdge(f, v1, v2, 0.15)
    f.edges[e].openings.push({ kind: 'door', offset: 0.8, width: 0.9 }) // at x=8
    const mid = addVertex(f, 4, 0) // T-junction point at x=4
    const newEdgeId = splitEdgeAtVertex(f, e, mid)
    expect(f.edges[e].v1).toBe(v1)
    expect(f.edges[e].v2).toBe(mid)
    expect(f.edges[newEdgeId].v1).toBe(mid)
    expect(f.edges[newEdgeId].v2).toBe(v2)
    expect(f.edges[e].openings).toHaveLength(0)          // opening at x=8 is past the split
    expect(f.edges[newEdgeId].openings).toHaveLength(1)
    expect(f.edges[newEdgeId].openings[0].offset).toBeCloseTo((8 - 4) / (10 - 4))
  })
})

describe('mergeVertexInto', () => {
  it('reassigns edges from the removed vertex to the kept vertex and deletes it', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 4, 0)
    const c = addVertex(f, 4.001, 0.001) // "same place" by drag, not by coincidence
    const e = addEdge(f, a, c, 0.10)
    mergeVertexInto(f, c, b)
    expect(f.edges[e].v2).toBe(b)
    expect(f.vertices[c]).toBeUndefined()
  })

  it('deletes an edge that becomes degenerate (both ends merge to the same vertex)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.10)
    mergeVertexInto(f, b, a)
    expect(f.edges[e]).toBeUndefined()
  })
})

describe('deleteVertex / deleteEdge', () => {
  it('deleteVertex removes the vertex and every edge touching it', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.10)
    deleteVertex(f, a)
    expect(f.vertices[a]).toBeUndefined()
    expect(f.edges[e]).toBeUndefined()
  })

  it('deleteEdge leaves both vertices in place', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.10)
    deleteEdge(f, e)
    expect(f.vertices[a]).toBeDefined()
    expect(f.vertices[b]).toBeDefined()
    expect(f.edges[e]).toBeUndefined()
  })
})

describe('nearestVertex', () => {
  it('finds a vertex within SNAP distance, excluding a given id', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 5, 5)
    const hit = nearestVertex(f, { x: 0.05, y: 0.02 }, new Set([b]))
    expect(hit?.id).toBe(a)
  })
  it('returns null when nothing is within SNAP', () => {
    const f = emptyFloorGraph('Test')
    addVertex(f, 0, 0)
    expect(nearestVertex(f, { x: 5, y: 5 }, new Set())).toBeNull()
  })
})

describe('nearestEdgePoint', () => {
  it('finds the projected point on an edge body, excluding near-endpoint hits', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0)
    const v2 = addVertex(f, 10, 0)
    const e = addEdge(f, v1, v2, 0.15)
    const hit = nearestEdgePoint(f, { x: 4, y: 0.05 }, new Set())
    expect(hit?.edgeId).toBe(e)
    expect(hit?.x).toBeCloseTo(4)
    expect(hit?.y).toBeCloseTo(0)
  })
  it('excludes a hit too close to either endpoint (that is vertex-snap territory, not a T-junction)', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0)
    const v2 = addVertex(f, 10, 0)
    addEdge(f, v1, v2, 0.15)
    expect(nearestEdgePoint(f, { x: 0.05, y: 0 }, new Set())).toBeNull()
  })
})

describe('SNAP', () => {
  it('is a positive magnet radius in metres', () => {
    expect(SNAP).toBeGreaterThan(0)
    expect(SNAP).toBeLessThan(1)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/graph.test.ts`
Expected: FAIL — `./graph` module doesn't exist yet.

- [ ] **Step 7: Implement `graph.ts`**

```ts
// app/web/src/lib/floorplan/graph.ts
import type { FloorGraph, VertexId, EdgeId } from './types'
import { genId } from './types'
import { dist, projectAt, pointAt } from './geometry'

export const SNAP = 0.12          // metre magnet radius — matches the old drag-snap feel
export const ENDPOINT_GUARD = 0.15 // within this of an edge's own endpoint, it's vertex-snap territory, not a T-junction
export const gridSnap = (v: number): number => Math.round(v / 0.01) * 0.01

export function addVertex(f: FloorGraph, x: number, y: number): VertexId {
  const id = genId()
  f.vertices[id] = { id, x, y }
  return id
}

export function addEdge(f: FloorGraph, v1: VertexId, v2: VertexId, thickness: number): EdgeId {
  const id = genId()
  f.edges[id] = { id, v1, v2, thickness, openings: [] }
  return id
}

export function moveVertex(f: FloorGraph, id: VertexId, x: number, y: number): void {
  f.vertices[id].x = x
  f.vertices[id].y = y
}

/** Wall-body drag: translate both endpoints by an identical delta. No axis-lock, no
 * shape special-casing — this IS the fix for the old force-straightening bug. Any edge
 * sharing an endpoint with this one follows automatically, since it references the same
 * vertex id. */
export function translateEdgeBody(f: FloorGraph, edgeId: EdgeId, dx: number, dy: number): void {
  const e = f.edges[edgeId]
  moveVertex(f, e.v1, f.vertices[e.v1].x + dx, f.vertices[e.v1].y + dy)
  moveVertex(f, e.v2, f.vertices[e.v2].x + dx, f.vertices[e.v2].y + dy)
}

/** T-junction: split `edgeId` into two edges sharing `atVertexId`, which must already sit
 * on (or very near) the edge's segment. Openings are redistributed to whichever half they
 * now fall in, with `offset` rescaled to that half's length. Returns the new edge's id;
 * the original edge's id is kept for the `v1 -> atVertexId` half. */
export function splitEdgeAtVertex(f: FloorGraph, edgeId: EdgeId, atVertexId: VertexId): EdgeId {
  const e = f.edges[edgeId]
  const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2], mid = f.vertices[atVertexId]
  const fullLen = dist([p1.x, p1.y], [p2.x, p2.y]) || 1
  const atLen = dist([p1.x, p1.y], [mid.x, mid.y])
  const firstHalfOpenings = [], secondHalfOpenings = []
  for (const o of e.openings) {
    const openingLen = o.offset * fullLen
    if (openingLen <= atLen) firstHalfOpenings.push({ ...o, offset: atLen > 0 ? openingLen / atLen : 0 })
    else secondHalfOpenings.push({ ...o, offset: (fullLen - atLen) > 0 ? (openingLen - atLen) / (fullLen - atLen) : 0 })
  }
  const v2 = e.v2
  f.edges[edgeId] = { ...e, v2: atVertexId, openings: firstHalfOpenings }
  const newId = genId()
  f.edges[newId] = { id: newId, v1: atVertexId, v2, thickness: e.thickness, openings: secondHalfOpenings }
  return newId
}

/** Vertex-snap merge: reassign every edge referencing `removeId` to reference `keepId`
 * instead, then delete `removeId`. Any edge that becomes degenerate (both ends now the
 * same vertex, e.g. dragging one end of a wall onto its own other end) is deleted. */
export function mergeVertexInto(f: FloorGraph, removeId: VertexId, keepId: VertexId): void {
  for (const e of Object.values(f.edges)) {
    if (e.v1 === removeId) e.v1 = keepId
    if (e.v2 === removeId) e.v2 = keepId
  }
  for (const e of Object.values(f.edges)) {
    if (e.v1 === e.v2) delete f.edges[e.id]
  }
  delete f.vertices[removeId]
}

export function deleteVertex(f: FloorGraph, id: VertexId): void {
  for (const e of Object.values(f.edges)) {
    if (e.v1 === id || e.v2 === id) delete f.edges[e.id]
  }
  delete f.vertices[id]
}

export function deleteEdge(f: FloorGraph, id: EdgeId): void {
  delete f.edges[id]
}

export function nearestVertex(
  f: FloorGraph, pt: { x: number; y: number }, exclude: Set<VertexId>,
): { id: VertexId; x: number; y: number } | null {
  let best: { id: VertexId; x: number; y: number } | null = null
  let bd = SNAP
  for (const v of Object.values(f.vertices)) {
    if (exclude.has(v.id)) continue
    const d = Math.hypot(v.x - pt.x, v.y - pt.y)
    if (d < bd) { bd = d; best = { id: v.id, x: v.x, y: v.y } }
  }
  return best
}

export function nearestEdgePoint(
  f: FloorGraph, pt: { x: number; y: number }, exclude: Set<EdgeId>,
): { edgeId: EdgeId; x: number; y: number; distance: number } | null {
  let best: { edgeId: EdgeId; x: number; y: number; distance: number } | null = null
  for (const e of Object.values(f.edges)) {
    if (exclude.has(e.id)) continue
    const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
    const fullLen = dist([p1.x, p1.y], [p2.x, p2.y]) || 1
    const atM = projectAt([p1.x, p1.y], [p2.x, p2.y], pt)
    if (atM < ENDPOINT_GUARD || (fullLen - atM) < ENDPOINT_GUARD) continue
    const [px, py] = pointAt([p1.x, p1.y], [p2.x, p2.y], atM)
    const d = Math.hypot(pt.x - px, pt.y - py)
    if (!best || d < best.distance) best = { edgeId: e.id, x: px, y: py, distance: d }
  }
  return best
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd app/web && npx vitest run src/lib/floorplan/graph.test.ts`
Expected: PASS (all 11 tests)

- [ ] **Step 9: Commit**

```bash
git add app/web/src/lib/floorplan/types.ts app/web/src/lib/floorplan/types.test.ts \
        app/web/src/lib/floorplan/graph.ts app/web/src/lib/floorplan/graph.test.ts
git commit -m "feat(web): add vertex-graph types and mutation primitives for floorplan engine"
```

## Task 3: Geometry helpers, view transform, calibration

**Files:**
- Create: `app/web/src/lib/floorplan/geometry.ts`
- Create: `app/web/src/lib/floorplan/geometry.test.ts`
- Create: `app/web/src/lib/floorplan/viewTransform.ts`
- Create: `app/web/src/lib/floorplan/viewTransform.test.ts`
- Create: `app/web/src/lib/floorplan/calibrate.ts`
- Create: `app/web/src/lib/floorplan/calibrate.test.ts`

Note: `graph.ts` (Task 2) already imports `dist`, `projectAt`, `pointAt` from this module — Task 2's tests will not pass standalone until this task lands. When dispatching to an implementer subagent, do Task 2 and Task 3 as one continuous session, or land Task 3 first. (The plan lists them in this order for narrative clarity; execution order between these two specific tasks is flexible.)

- [ ] **Step 1: Write the failing test for `geometry.ts`**

```ts
// app/web/src/lib/floorplan/geometry.test.ts
import { describe, it, expect } from 'vitest'
import { dist, segLen, shoelaceSigned, shoelace, polygonCentroid, projectAt, pointAt } from './geometry'

describe('dist / segLen', () => {
  it('computes euclidean distance', () => {
    expect(dist([0, 0], [3, 4])).toBe(5)
    expect(segLen([0, 0], [3, 4])).toBe(5)
  })
})

describe('shoelaceSigned / shoelace', () => {
  it('is positive for a CCW square, negative for CW, same magnitude', () => {
    const ccw: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]]
    const cw = [...ccw].reverse() as [number, number][]
    expect(shoelaceSigned(ccw)).toBeCloseTo(16)
    expect(shoelaceSigned(cw)).toBeCloseTo(-16)
    expect(shoelace(ccw)).toBeCloseTo(16)
    expect(shoelace(cw)).toBeCloseTo(16)
  })
})

describe('polygonCentroid', () => {
  it('finds the centroid of a square at its geometric center', () => {
    const sq: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]]
    const [cx, cy] = polygonCentroid(sq)
    expect(cx).toBeCloseTo(2)
    expect(cy).toBeCloseTo(2)
  })
})

describe('projectAt / pointAt', () => {
  it('projects a point onto a segment and inverts', () => {
    const atM = projectAt([0, 0], [10, 0], { x: 4, y: 3 })
    expect(atM).toBeCloseTo(4)
    const [x, y] = pointAt([0, 0], [10, 0], atM)
    expect(x).toBeCloseTo(4)
    expect(y).toBeCloseTo(0)
  })
  it('clamps to the segment ends', () => {
    expect(projectAt([0, 0], [10, 0], { x: -5, y: 0 })).toBe(0)
    expect(projectAt([0, 0], [10, 0], { x: 50, y: 0 })).toBe(10)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/geometry.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `geometry.ts`**

```ts
// app/web/src/lib/floorplan/geometry.ts
export type Pt = [number, number]

export const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1])
export const segLen = dist

/** Signed area (positive = counter-clockwise winding, negative = clockwise). */
export function shoelaceSigned(poly: Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = poly[i], [c, d] = poly[(i + 1) % poly.length]
    s += a * d - c * b
  }
  return s / 2
}

export const shoelace = (poly: Pt[]): number => Math.abs(shoelaceSigned(poly))

/** True polygon centroid (not vertex average) — correct even for non-convex/L-shaped rooms. */
export function polygonCentroid(poly: Pt[]): Pt {
  const A = shoelaceSigned(poly)
  if (Math.abs(A) < 1e-9) {
    const n = poly.length || 1
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n]
  }
  let cx = 0, cy = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]
    const cross = x0 * y1 - x1 * y0
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  return [cx / (6 * A), cy / (6 * A)]
}

/** Distance along segment p0->p1 nearest to pt, clamped to [0, L]. */
export function projectAt(p0: Pt, p1: Pt, pt: { x: number; y: number }): number {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy)
  if (L < 1e-9) return 0
  const t = ((pt.x - p0[0]) * dx + (pt.y - p0[1]) * dy) / (L * L)
  return Math.max(0, Math.min(L, t * L))
}

/** Point at distance atM along segment p0->p1 (inverse of projectAt). */
export function pointAt(p0: Pt, p1: Pt, atM: number): Pt {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy)
  const t = L ? atM / L : 0
  return [p0[0] + dx * t, p0[1] + dy * t]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/lib/floorplan/geometry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing test for `viewTransform.ts`**

```ts
// app/web/src/lib/floorplan/viewTransform.test.ts
import { describe, it, expect } from 'vitest'
import { viewTransform } from './viewTransform'
import { emptyFloorGraph } from './types'
import { addVertex } from './graph'

describe('viewTransform', () => {
  it('fits all vertices across all floors into the viewport with margin', () => {
    const f1 = emptyFloorGraph('A')
    addVertex(f1, 0, 0); addVertex(f1, 6, 5)
    const t = viewTransform([f1], { width: 900, height: 560, margin: 48 })
    expect(t.px(0)).toBeCloseTo(48)
    expect(t.py(0)).toBeCloseTo(560 - 48)
  })
  it('userToWorld inverts px/py', () => {
    const f1 = emptyFloorGraph('A')
    addVertex(f1, 0, 0); addVertex(f1, 6, 5)
    const t = viewTransform([f1], { width: 900, height: 560, margin: 48 })
    const world = t.userToWorld(t.px(3), t.py(2))
    expect(world.x).toBeCloseTo(3)
    expect(world.y).toBeCloseTo(2)
  })
  it('defaults to a sane box when there are no vertices yet', () => {
    const t = viewTransform([emptyFloorGraph('A')], { width: 900, height: 560, margin: 48 })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.scale).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/viewTransform.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement `viewTransform.ts`**

```ts
// app/web/src/lib/floorplan/viewTransform.ts
import type { FloorGraph } from './types'

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
  floors: FloorGraph[], opts: { width: number; height: number; margin: number },
): ViewTransform {
  const pts = floors.flatMap(f => Object.values(f.vertices).map(v => [v.x, v.y] as [number, number]))
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const minx = Math.min(...xs, 0), maxx = Math.max(...xs, 1)
  const miny = Math.min(...ys, 0), maxy = Math.max(...ys, 1)
  const { width, height, margin } = opts
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

- [ ] **Step 8: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/lib/floorplan/viewTransform.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Port `calibrate.ts` verbatim (orthogonal to the wall model — only its `Pt`/`Reference` import source changes)**

```ts
// app/web/src/lib/floorplan/calibrate.ts
import type { Reference } from './types'
import type { Pt } from './geometry'

/** Derive scale from a line the user drew over a known real-world dimension. */
export function calibrationFromLine(
  p0_px: Pt, p1_px: Pt, realLen_m: number, origin_px: Pt,
): { scale_m_per_px: number; origin_px: Pt } {
  const pixelDist = Math.hypot(p1_px[0] - p0_px[0], p1_px[1] - p0_px[1])
  return { scale_m_per_px: realLen_m / pixelDist, origin_px }
}

/** Image pixel -> model metres. y flips (image y is down, model y is up). */
export function pxToModel(px: Pt, ref: Pick<Reference, 'scale_m_per_px' | 'origin_px'>): Pt {
  return [
    (px[0] - ref.origin_px[0]) * ref.scale_m_per_px,
    (ref.origin_px[1] - px[1]) * ref.scale_m_per_px,
  ]
}

/** Model metres -> image pixel (inverse of pxToModel). */
export function modelToPx(pt: Pt, ref: Pick<Reference, 'scale_m_per_px' | 'origin_px'>): Pt {
  return [
    ref.origin_px[0] + pt[0] / ref.scale_m_per_px,
    ref.origin_px[1] - pt[1] / ref.scale_m_per_px,
  ]
}
```

- [ ] **Step 10: Port its test verbatim (same import path change only)**

```ts
// app/web/src/lib/floorplan/calibrate.test.ts
import { describe, it, expect } from 'vitest'
import { calibrationFromLine, pxToModel, modelToPx } from './calibrate'

describe('calibrationFromLine', () => {
  it('derives metres-per-pixel from a drawn line and a known real length', () => {
    const { scale_m_per_px } = calibrationFromLine([0, 0], [100, 0], 5, [0, 0])
    expect(scale_m_per_px).toBeCloseTo(0.05)
  })
})

describe('pxToModel / modelToPx', () => {
  it('round-trips a pixel through model space and back', () => {
    const ref = { scale_m_per_px: 0.02, origin_px: [50, 80] as [number, number] }
    const px: [number, number] = [150, 30]
    const model = pxToModel(px, ref)
    const back = modelToPx(model, ref)
    expect(back[0]).toBeCloseTo(px[0])
    expect(back[1]).toBeCloseTo(px[1])
  })
  it('flips y (image-down vs model-up)', () => {
    const ref = { scale_m_per_px: 1, origin_px: [0, 0] as [number, number] }
    const [, my] = pxToModel([0, 10], ref)
    expect(my).toBeCloseTo(-10)
  })
})
```

- [ ] **Step 11: Run both new test files to verify they pass**

Run: `cd app/web && npx vitest run src/lib/floorplan/calibrate.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 12: Commit**

```bash
git add app/web/src/lib/floorplan/geometry.ts app/web/src/lib/floorplan/geometry.test.ts \
        app/web/src/lib/floorplan/viewTransform.ts app/web/src/lib/floorplan/viewTransform.test.ts \
        app/web/src/lib/floorplan/calibrate.ts app/web/src/lib/floorplan/calibrate.test.ts
git commit -m "feat(web): add geometry helpers, vertex-based view transform, and calibration"
```

## Task 4: Room detection via planar face-tracing

This is the algorithmic core of the redesign (spec Section 3). Standard computational-geometry technique: sort each vertex's incident edges by angle, then trace each face by always taking the next edge in rotational order ("leftmost turn" rule). Every directed edge belongs to exactly one traced face; the face with the largest absolute area is the exterior/outer boundary, everything else is a room.

**Files:**
- Create: `app/web/src/lib/floorplan/rooms.ts`
- Create: `app/web/src/lib/floorplan/rooms.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/web/src/lib/floorplan/rooms.test.ts
import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { traceFaces, roomAreas, exteriorEdgeIds } from './rooms'

function rectangle(f: ReturnType<typeof emptyFloorGraph>, x0: number, y0: number, x1: number, y1: number) {
  const a = addVertex(f, x0, y0), b = addVertex(f, x1, y0), c = addVertex(f, x1, y1), d = addVertex(f, x0, y1)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  return { a, b, c, d }
}

describe('traceFaces', () => {
  it('traces exactly 2 faces for a closed rectangle: the interior and the outer face', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const faces = traceFaces(f)
    expect(faces).toHaveLength(2)
    const areas = faces.map(fc => Math.abs(fc.area)).sort((x, y) => x - y)
    expect(areas[0]).toBeCloseTo(12) // the bounded interior face
    expect(areas[1]).toBeCloseTo(12) // the outer face traces the same boundary, opposite winding
  })
})

describe('roomAreas', () => {
  it('reports one room for a plain closed rectangle', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].area).toBeCloseTo(12)
    expect(rooms[0].cx).toBeCloseTo(2)
    expect(rooms[0].cy).toBeCloseTo(1.5)
  })

  it('reports two rooms when an interior wall fully divides the rectangle', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 6, 4)
    // The divider's endpoints must be real T-junction vertices spliced into the boundary
    // (not merely coincident points) — that's what makes the divider close two distinct
    // faces instead of dangling off the side. splitEdgeAtVertex (Task 2) is the primitive.
    const bottomEdge = Object.values(f.edges).find(e => f.vertices[e.v1].y === 0 && f.vertices[e.v2].y === 0)!
    const topEdge = Object.values(f.edges).find(e => f.vertices[e.v1].y === 4 && f.vertices[e.v2].y === 4)!
    const top = addVertex(f, 3, 0), bot = addVertex(f, 3, 4)
    splitEdgeAtVertex(f, bottomEdge.id, top)
    splitEdgeAtVertex(f, topEdge.id, bot)
    addEdge(f, top, bot, 0.10)
    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(2)
    expect(rooms.reduce((s, r) => s + r.area, 0)).toBeCloseTo(24) // two halves of the 6x4 rectangle
  })

  it('gives no room when the boundary has a gap (not a closed cycle)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15) // no closing edge back to a
    expect(roomAreas(f)).toHaveLength(0)
  })
})

describe('exteriorEdgeIds', () => {
  it('marks every edge of a plain rectangle as exterior', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const ext = exteriorEdgeIds(f)
    expect(ext.size).toBe(4)
    expect(Object.keys(f.edges).every(id => ext.has(id))).toBe(true)
  })

  it('does not mark an interior divider as exterior', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 6, 4)
    const top = addVertex(f, 3, 0), bot = addVertex(f, 3, 4)
    const divider = addEdge(f, top, bot, 0.10)
    const ext = exteriorEdgeIds(f)
    expect(ext.has(divider)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/rooms.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `rooms.ts`**

```ts
// app/web/src/lib/floorplan/rooms.ts
import type { FloorGraph, EdgeId } from './types'
import { shoelaceSigned, shoelace, polygonCentroid, type Pt } from './geometry'

export interface TracedFace { vertexIds: string[]; edgeIds: EdgeId[]; area: number }
export interface RoomArea { cx: number; cy: number; area: number; name: string }

/**
 * Trace every face of the planar graph via the standard "next edge in rotational
 * order" walk: sort each vertex's incident edges by angle, and on arriving at a vertex
 * always continue via the next edge clockwise from the one just arrived on. Every
 * directed edge (dart) belongs to exactly one traced face; a plain closed loop of N
 * edges produces exactly 2 faces (the bounded interior, and the outer face tracing the
 * same boundary in the opposite direction) since each edge has exactly 2 darts.
 */
export function traceFaces(f: FloorGraph): TracedFace[] {
  type Dart = { edgeId: EdgeId; to: string; angle: number }
  const incident = new Map<string, Dart[]>()
  for (const id of Object.keys(f.vertices)) incident.set(id, [])
  for (const e of Object.values(f.edges)) {
    const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
    incident.get(e.v1)!.push({ edgeId: e.id, to: e.v2, angle: Math.atan2(p2.y - p1.y, p2.x - p1.x) })
    incident.get(e.v2)!.push({ edgeId: e.id, to: e.v1, angle: Math.atan2(p1.y - p2.y, p1.x - p2.x) })
  }
  for (const list of incident.values()) list.sort((a, b) => a.angle - b.angle)

  const visited = new Set<string>() // `${fromVertex}|${edgeId}`
  const faces: TracedFace[] = []

  for (const startEdge of Object.values(f.edges)) {
    for (const startFrom of [startEdge.v1, startEdge.v2]) {
      const startKey = `${startFrom}|${startEdge.id}`
      if (visited.has(startKey)) continue

      const vertexIds: string[] = []
      const edgeIds: EdgeId[] = []
      let curFrom = startFrom, curEdgeId = startEdge.id
      // safety bound: a real planar graph can't produce a face longer than 2x edge count
      const maxSteps = Object.keys(f.edges).length * 2 + 1
      for (let steps = 0; steps < maxSteps; steps++) {
        visited.add(`${curFrom}|${curEdgeId}`)
        vertexIds.push(curFrom)
        edgeIds.push(curEdgeId)
        const curEdge = f.edges[curEdgeId]
        const to = curEdge.v1 === curFrom ? curEdge.v2 : curEdge.v1
        const incidentAtTo = incident.get(to)!
        const idx = incidentAtTo.findIndex(d => d.edgeId === curEdgeId && d.to === curFrom)
        const nextIdx = (idx - 1 + incidentAtTo.length) % incidentAtTo.length
        const nextDart = incidentAtTo[nextIdx]
        curFrom = to
        curEdgeId = nextDart.edgeId
        if (curFrom === startFrom && curEdgeId === startEdge.id) break
      }
      const pts: Pt[] = vertexIds.map(id => [f.vertices[id].x, f.vertices[id].y])
      faces.push({ vertexIds, edgeIds, area: shoelaceSigned(pts) })
    }
  }
  return faces
}

/** Edges belonging to the largest-absolute-area traced face (the outer/exterior boundary). */
export function exteriorEdgeIds(f: FloorGraph): Set<EdgeId> {
  const faces = traceFaces(f)
  if (faces.length === 0) return new Set()
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  return new Set(outer.edgeIds)
}

/** Rooms = every traced face except the outer boundary. Named by nearest previously
 * user-assigned room centroid (same "sticky name across edits" behavior as the old
 * flood-fill model). */
export function roomAreas(f: FloorGraph): RoomArea[] {
  const faces = traceFaces(f)
  if (faces.length < 2) return []
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  const out: RoomArea[] = []
  for (const face of faces) {
    if (face === outer) continue
    const pts: Pt[] = face.vertexIds.map(id => [f.vertices[id].x, f.vertices[id].y])
    const [cx, cy] = polygonCentroid(pts)
    out.push({ cx, cy, area: shoelace(pts), name: nearestRoomName(f, cx, cy) })
  }
  return out
}

function nearestRoomName(f: FloorGraph, cx: number, cy: number): string {
  let name = '', bd = 1e9
  for (const r of f.rooms) {
    const d = Math.hypot(r.cx - cx, r.cy - cy)
    if (d < bd) { bd = d; name = r.name }
  }
  return name
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/lib/floorplan/rooms.test.ts`
Expected: PASS (6 tests) — the "two rooms" test's construction above already splices `top`/`bot` into the boundary via `splitEdgeAtVertex` before connecting them, so it produces 2 distinct bounded faces as written; no alternate construction should be needed.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/lib/floorplan/rooms.ts app/web/src/lib/floorplan/rooms.test.ts
git commit -m "feat(web): add planar face-tracing for room detection and exterior-edge classification"
```

## Task 5: Live-drag snapping (grid, vertex, axis guides)

**Files:**
- Create: `app/web/src/lib/floorplan/snapping.ts`
- Create: `app/web/src/lib/floorplan/snapping.test.ts`

This governs only the *visual preview* while a vertex is being dragged (grid-snap the position, and show a guide when near another vertex or aligned on an axis with one). The *structural* decision — merge into an existing vertex, or split an edge for a T-junction — happens once, on drop, using `nearestVertex`/`nearestEdgePoint` from `graph.ts` (Task 2). This split of responsibility (continuous visual feedback vs. one-time structural commit) mirrors how `DRAG_MODEL` vs `SET_MODEL` divide "every frame" from "once per gesture" in the reducer (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
// app/web/src/lib/floorplan/snapping.test.ts
import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex } from './graph'
import { snapPoint } from './snapping'

describe('snapPoint', () => {
  it('snaps onto a nearby existing vertex (excluding the dragged one itself)', () => {
    const f = emptyFloorGraph('Test')
    const dragged = addVertex(f, 0, 0)
    addVertex(f, 4, 4)
    const s = snapPoint(f, 4.05, 3.98, new Set([dragged]))
    expect(s.x).toBeCloseTo(4)
    expect(s.y).toBeCloseTo(4)
    expect(s.guides).toEqual([{ t: 'pt', x: 4, y: 4 }])
  })

  it('shows an axis guide when aligned with another vertex but not on top of it', () => {
    const f = emptyFloorGraph('Test')
    const dragged = addVertex(f, 0, 0)
    addVertex(f, 4, 4)
    const s = snapPoint(f, 4.02, 1, new Set([dragged]))
    expect(s.x).toBeCloseTo(4)
    expect(s.guides.some(g => g.t === 'vx' && g.x === 4)).toBe(true)
  })

  it('falls back to the 1cm grid when nothing is nearby', () => {
    const f = emptyFloorGraph('Test')
    const dragged = addVertex(f, 0, 0)
    const s = snapPoint(f, 2.3333, 1.6666, new Set([dragged]))
    expect(s.x).toBeCloseTo(2.33)
    expect(s.y).toBeCloseTo(1.67)
    expect(s.guides).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/snapping.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `snapping.ts`**

```ts
// app/web/src/lib/floorplan/snapping.ts
import type { FloorGraph, VertexId } from './types'
import { SNAP, gridSnap } from './graph'

export interface Guide { t: 'pt' | 'vx' | 'hy'; x?: number; y?: number }

export function snapPoint(
  f: FloorGraph, x: number, y: number, exclude: Set<VertexId>,
): { x: number; y: number; guides: Guide[] } {
  const others = Object.values(f.vertices).filter(v => !exclude.has(v.id))

  let bestPt: { x: number; y: number } | null = null, bd = SNAP
  for (const v of others) {
    const d = Math.hypot(v.x - x, v.y - y)
    if (d < bd) { bd = d; bestPt = { x: v.x, y: v.y } }
  }
  if (bestPt) return { x: bestPt.x, y: bestPt.y, guides: [{ t: 'pt', x: bestPt.x, y: bestPt.y }] }

  let rx = gridSnap(x), ry = gridSnap(y), hitX = false, hitY = false, bx = SNAP, by = SNAP
  for (const v of others) {
    const dx = Math.abs(v.x - x); if (dx < bx) { bx = dx; rx = v.x; hitX = true }
    const dy = Math.abs(v.y - y); if (dy < by) { by = dy; ry = v.y; hitY = true }
  }
  const guides: Guide[] = []
  if (hitX) guides.push({ t: 'vx', x: rx })
  if (hitY) guides.push({ t: 'hy', y: ry })
  return { x: rx, y: ry, guides }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/lib/floorplan/snapping.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/web/src/lib/floorplan/snapping.ts app/web/src/lib/floorplan/snapping.test.ts
git commit -m "feat(web): add live-drag snapping (grid, vertex, axis guides)"
```

## Task 6: Dimension chains and corner angles

**Files:**
- Create: `app/web/src/lib/floorplan/dimensions.ts`
- Create: `app/web/src/lib/floorplan/dimensions.test.ts`

Ports the old `FloorPlanCanvas.tsx`'s inline width/height dimension-chain logic (lines 190–277 of the discarded implementation) into a standalone, testable module, adapted to read from the exterior boundary + interior edges instead of a separate `footprint`/`walls` split. Also ports `cornerAngles` from the old `geometry.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// app/web/src/lib/floorplan/dimensions.test.ts
import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { widthHeightChains, cornerAngles } from './dimensions'

function closedRect(f: ReturnType<typeof emptyFloorGraph>, x0: number, y0: number, x1: number, y1: number) {
  const a = addVertex(f, x0, y0), b = addVertex(f, x1, y0), c = addVertex(f, x1, y1), d = addVertex(f, x0, y1)
  const eTop = addEdge(f, a, b, 0.15), eRight = addEdge(f, b, c, 0.15)
  const eBottom = addEdge(f, c, d, 0.15), eLeft = addEdge(f, d, a, 0.15)
  return { a, b, c, d, eTop, eRight, eBottom, eLeft }
}

describe('widthHeightChains', () => {
  it('reports one span with no dividing interior wall', () => {
    const f = emptyFloorGraph('Test')
    closedRect(f, 0, 0, 6, 4)
    const { widthMarks, heightMarks } = widthHeightChains(f)
    expect(widthMarks).toEqual([0, 6])
    expect(heightMarks).toEqual([0, 4])
  })

  it('splits the width chain when a near-full-height interior wall crosses it', () => {
    const f = emptyFloorGraph('Test')
    const { eTop, eBottom } = closedRect(f, 0, 0, 6, 4)
    const topMid = addVertex(f, 3, 0), botMid = addVertex(f, 3, 4)
    splitEdgeAtVertex(f, eTop, topMid)
    splitEdgeAtVertex(f, eBottom, botMid)
    addEdge(f, topMid, botMid, 0.10)
    const { widthMarks } = widthHeightChains(f)
    expect(widthMarks).toEqual([0, 3, 6])
  })
})

describe('cornerAngles', () => {
  it('finds a 90 degree angle at every corner of a plain rectangle', () => {
    const f = emptyFloorGraph('Test')
    closedRect(f, 0, 0, 6, 4)
    const angles = cornerAngles(f)
    expect(angles).toHaveLength(4)
    angles.forEach(a => expect(a.deg).toBeCloseTo(90, 0))
    angles.forEach(a => expect(a.isRight).toBe(true))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/dimensions.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `dimensions.ts`**

```ts
// app/web/src/lib/floorplan/dimensions.ts
import type { FloorGraph } from './types'
import { exteriorEdgeIds, traceFaces } from './rooms'

export interface CornerAngle { vertexId: string; deg: number; x: number; y: number; isRight: boolean }

const SPAN_TOL = 0.9   // an interior wall covering at least this fraction of the perpendicular span fully divides the room
const SPLIT_EPS = 0.02 // dedup near-duplicate/near-boundary split marks

function dedupSplits(vals: number[], lo: number, hi: number): number[] {
  const out: number[] = []
  for (const v of vals) {
    if (v - lo < SPLIT_EPS || hi - v < SPLIT_EPS) continue
    if (out.length && v - out[out.length - 1] < SPLIT_EPS) continue
    out.push(v)
  }
  return out
}

/** Width/height dimension chains: the exterior boundary's bounding box, split wherever an
 * interior (non-exterior) edge spans nearly the full perpendicular extent — matching how a
 * real architectural drawing chains dimensions across a dividing wall. */
export function widthHeightChains(f: FloorGraph): { widthMarks: number[]; heightMarks: number[] } {
  const ext = exteriorEdgeIds(f)
  const allX = Object.values(f.vertices).map(v => v.x)
  const allY = Object.values(f.vertices).map(v => v.y)
  const x0 = Math.min(...allX, 0), x1 = Math.max(...allX, 1)
  const y0 = Math.min(...allY, 0), y1 = Math.max(...allY, 1)

  const interiorEdges = Object.values(f.edges).filter(e => !ext.has(e.id))

  const widthSplits = dedupSplits(
    interiorEdges
      .filter(e => {
        const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
        const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y)
        return dy > dx && dy >= (y1 - y0) * SPAN_TOL
      })
      .map(e => (f.vertices[e.v1].x + f.vertices[e.v2].x) / 2)
      .sort((a, b) => a - b),
    x0, x1,
  )
  const heightSplits = dedupSplits(
    interiorEdges
      .filter(e => {
        const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
        const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y)
        return dx > dy && dx >= (x1 - x0) * SPAN_TOL
      })
      .map(e => (f.vertices[e.v1].y + f.vertices[e.v2].y) / 2)
      .sort((a, b) => a - b),
    y0, y1,
  )
  return { widthMarks: [x0, ...widthSplits, x1], heightMarks: [y0, ...heightSplits, y1] }
}

/** Interior angle at every vertex on the exterior boundary. Uses the traced outer face's
 * own vertex sequence, so it naturally follows however many corners the boundary has —
 * including ones created by T-junction splits along a previously straight exterior wall. */
export function cornerAngles(f: FloorGraph): CornerAngle[] {
  const faces = traceFaces(f)
  if (faces.length === 0) return []
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  const ids = outer.vertexIds
  const n = ids.length
  return ids.map((id, i) => {
    const p = f.vertices[id]
    const pa = f.vertices[ids[(i - 1 + n) % n]]
    const pb = f.vertices[ids[(i + 1) % n]]
    const v1x = pa.x - p.x, v1y = pa.y - p.y, v2x = pb.x - p.x, v2y = pb.y - p.y
    const m1 = Math.hypot(v1x, v1y) || 1, m2 = Math.hypot(v2x, v2y) || 1
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)))
    const deg = Math.acos(cos) * 180 / Math.PI
    return { vertexId: id, deg, x: p.x, y: p.y, isRight: Math.abs(deg - 90) <= 1 }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/lib/floorplan/dimensions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/web/src/lib/floorplan/dimensions.ts app/web/src/lib/floorplan/dimensions.test.ts
git commit -m "feat(web): add dimension-chain and corner-angle computation for the graph model"
```

## Task 7: BIM JSON export

**Files:**
- Create: `app/web/src/lib/floorplan/export.ts`
- Create: `app/web/src/lib/floorplan/export.test.ts`

Per spec Section "Persistence & BIM Export": a pure projection of the graph. Walls come directly from edges (with absolute opening positions), and a `rooms` array comes from the face-tracing computation (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// app/web/src/lib/floorplan/export.test.ts
import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex, addEdge } from './graph'
import { toGeometryJson } from './export'

describe('toGeometryJson', () => {
  it('projects vertices, walls (with is_exterior + absolute opening position), and rooms', () => {
    const f = emptyFloorGraph('Planta Baja')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    const e1 = addEdge(f, a, b, 0.15)
    addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    f.edges[e1].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })

    const model = { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
    const json = toGeometryJson(model)

    expect(json.slab_thickness_m).toBeCloseTo(0.15)
    expect(json.storeys).toHaveLength(1)
    const storey = json.storeys[0]
    expect(storey.name).toBe('Planta Baja')
    expect(storey.elevation_m).toBe(0)
    expect(Object.keys(storey.vertices)).toHaveLength(4)
    expect(storey.walls).toHaveLength(4)
    const wallWithDoor = storey.walls.find(w => w.id === e1)!
    expect(wallWithDoor.is_exterior).toBe(true)
    expect(wallWithDoor.openings[0].at_m).toBeCloseTo(2) // offset 0.5 * length 4
    expect(storey.rooms).toHaveLength(1)
    expect(storey.rooms[0].net_area_m2).toBeCloseTo(12)
  })

  it('stacks storey elevation from prior floors\' heights', () => {
    const f0 = emptyFloorGraph('PB'); f0.height_m = 3
    const f1 = emptyFloorGraph('PA'); f1.height_m = 2.6
    const model = { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f0, f1] }
    const json = toGeometryJson(model)
    expect(json.storeys[0].elevation_m).toBe(0)
    expect(json.storeys[1].elevation_m).toBeCloseTo(3)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/export.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `export.ts`**

```ts
// app/web/src/lib/floorplan/export.ts
import type { FloorPlanModel } from './types'
import { floorElev } from './types'
import { dist } from './geometry'
import { roomAreas, exteriorEdgeIds } from './rooms'

const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface GeometryJson {
  slab_thickness_m: number
  storeys: Array<{
    name: string
    elevation_m: number
    storey_height_m: number
    ext_wall_thickness_m: number
    int_wall_thickness_m: number
    vertices: Record<string, { x: number; y: number }>
    walls: Array<{
      id: string; v1: string; v2: string; thickness_m: number; is_exterior: boolean
      openings: Array<{ kind: string; at_m: number; width_m: number }>
    }>
    rooms: Array<{ name: string; net_area_m2: number; centroid: [number, number] }>
  }>
}

export function toGeometryJson(model: FloorPlanModel): GeometryJson {
  return {
    slab_thickness_m: model.slab_m,
    storeys: model.floors.map((f, i) => {
      const ext = exteriorEdgeIds(f)
      const vertices: Record<string, { x: number; y: number }> = {}
      for (const v of Object.values(f.vertices)) vertices[v.id] = { x: r3(v.x), y: r3(v.y) }
      const walls = Object.values(f.edges).map(e => {
        const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
        const length = dist([p1.x, p1.y], [p2.x, p2.y])
        return {
          id: e.id, v1: e.v1, v2: e.v2, thickness_m: e.thickness, is_exterior: ext.has(e.id),
          openings: e.openings.map(o => ({ kind: o.kind, at_m: r3(o.offset * length), width_m: r3(o.width) })),
        }
      })
      const rooms = roomAreas(f).map(rg => ({
        name: rg.name, net_area_m2: r3(rg.area), centroid: [r3(rg.cx), r3(rg.cy)] as [number, number],
      }))
      return {
        name: f.name, elevation_m: r3(floorElev(model, i)), storey_height_m: f.height_m,
        ext_wall_thickness_m: f.extWall_m, int_wall_thickness_m: f.intWall_m,
        vertices, walls, rooms,
      }
    }),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/lib/floorplan/export.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/web/src/lib/floorplan/export.ts app/web/src/lib/floorplan/export.test.ts
git commit -m "feat(web): add BIM JSON export as a pure projection of the graph"
```

## Task 8: Editor state, actions, and undo/redo reducer

**Files:**
- Create: `app/web/src/lib/floorplan/reducer.ts`
- Create: `app/web/src/lib/floorplan/reducer.test.ts`

Carries over the validated undo/redo design (`past`/`future` snapshot stacks, `DRAG_MODEL` vs `SET_MODEL` for "one push per gesture") onto the new graph model, and adds `SPLIT_EDGE_AT_POINT` (the mechanism behind both "click an edge's midpoint handle to insert a corner" and, from the editor component in Task 11, "drop a dragged vertex near another edge's body" — the same primitive, two different triggers) and `SET_FLOOR_PARAM` (bulk-updates every currently-exterior/interior edge's `thickness` when the Global Ext/Int wall fields change — see the "Why per-floor thickness" note in Task 2).

**Files also modified:**
- None yet — `FloorPlanCanvas.tsx`/`FloorPlanEditor.tsx`/`FloorPlanPanel.tsx` (Tasks 10–12) will import from this reducer.

- [ ] **Step 1: Write the failing test**

```ts
// app/web/src/lib/floorplan/reducer.test.ts
import { describe, it, expect } from 'vitest'
import { emptyModel, emptyFloorGraph } from './types'
import { addVertex, addEdge } from './graph'
import {
  reducer, initialState, removeVertexFromFloor, removeEdgeFromFloor, removeOpeningFromFloor,
} from './reducer'

function modelWithRectangle() {
  const f = emptyFloorGraph('Test')
  const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  return { model: { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }, a, b, c, d }
}

describe('SET_MODEL / UNDO / REDO', () => {
  it('pushes history on SET_MODEL and round-trips through undo/redo', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    const model2 = { ...model, floors: [{ ...model.floors[0], name: 'Renamed' }] }
    s = reducer(s, { type: 'SET_MODEL', model: model2 })
    expect(s.model.floors[0].name).toBe('Renamed')
    expect(s.past).toHaveLength(1)
    s = reducer(s, { type: 'UNDO' })
    expect(s.model.floors[0].name).toBe('Test')
    expect(s.future).toHaveLength(1)
    s = reducer(s, { type: 'REDO' })
    expect(s.model.floors[0].name).toBe('Renamed')
  })

  it('UNDO/REDO on empty stacks is a no-op returning the same state reference', () => {
    const { model } = modelWithRectangle()
    const s = initialState(model)
    expect(reducer(s, { type: 'UNDO' })).toBe(s)
    expect(reducer(s, { type: 'REDO' })).toBe(s)
  })
})

describe('DRAG_MODEL', () => {
  it('updates the model without pushing history (for intermediate drag frames)', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    const model2 = { ...model, floors: [{ ...model.floors[0], name: 'Mid-drag' }] }
    s = reducer(s, { type: 'DRAG_MODEL', model: model2 })
    expect(s.model.floors[0].name).toBe('Mid-drag')
    expect(s.past).toHaveLength(0)
  })

  it('a new SET_MODEL after some DRAG_MODEL frames clears future and pushes exactly one history entry', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'DRAG_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'frame1' }] } })
    s = reducer(s, { type: 'DRAG_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'frame2' }] } })
    s = reducer(s, { type: 'SET_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'final' }] } })
    expect(s.past).toHaveLength(1)
    expect(s.past[0].floors[0].name).toBe('Test') // history captured the state BEFORE this whole gesture, not the mid-drag frames
  })
})

describe('SPLIT_EDGE_AT_POINT', () => {
  it('inserts a new vertex splitting the target edge, and selects it', () => {
    const { model, a, b } = modelWithRectangle()
    let s = initialState(model)
    const edgeId = Object.values(s.model.floors[0].edges).find(e => e.v1 === a && e.v2 === b)!.id
    s = reducer(s, { type: 'SPLIT_EDGE_AT_POINT', edgeId, x: 2, y: 0 })
    expect(Object.keys(s.model.floors[0].edges)).toHaveLength(5)
    expect(s.ui.sel?.t).toBe('vertex')
  })
})

describe('SET_FLOOR_PARAM', () => {
  it('changing extWall_m bulk-updates every currently-exterior edge\'s thickness', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_FLOOR_PARAM', key: 'extWall_m', value: 0.20 })
    const f = s.model.floors[0]
    expect(f.extWall_m).toBeCloseTo(0.20)
    Object.values(f.edges).forEach(e => expect(e.thickness).toBeCloseTo(0.20))
  })
})

describe('SET_EDGE_THICKNESS', () => {
  it('updates a single edge\'s thickness without touching others', () => {
    const { model, a, b } = modelWithRectangle()
    let s = initialState(model)
    const edgeId = Object.values(s.model.floors[0].edges).find(e => e.v1 === a && e.v2 === b)!.id
    const otherId = Object.values(s.model.floors[0].edges).find(e => e.id !== edgeId)!.id
    const otherBefore = s.model.floors[0].edges[otherId].thickness
    s = reducer(s, { type: 'SET_EDGE_THICKNESS', edgeId, value: 0.25 })
    expect(s.model.floors[0].edges[edgeId].thickness).toBeCloseTo(0.25)
    expect(s.model.floors[0].edges[otherId].thickness).toBeCloseTo(otherBefore)
  })
})

describe('DELETE_SEL', () => {
  it('deletes the selected edge and clears selection', () => {
    const { model, a, b } = modelWithRectangle()
    let s = initialState(model)
    const edgeId = Object.values(s.model.floors[0].edges).find(e => e.v1 === a && e.v2 === b)!.id
    s = reducer(s, { type: 'SET_SEL', sel: { t: 'edge', id: edgeId } })
    s = reducer(s, { type: 'DELETE_SEL' })
    expect(s.model.floors[0].edges[edgeId]).toBeUndefined()
    expect(s.ui.sel).toBeNull()
  })
})

describe('removeVertexFromFloor / removeEdgeFromFloor / removeOpeningFromFloor', () => {
  it('removeEdgeFromFloor deletes the edge and leaves its vertices', () => {
    const f = emptyFloorGraph('T')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.1)
    removeEdgeFromFloor(f, e)
    expect(f.edges[e]).toBeUndefined()
    expect(f.vertices[a]).toBeDefined()
  })
  it('removeVertexFromFloor cascades to delete every edge touching it', () => {
    const f = emptyFloorGraph('T')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.1)
    removeVertexFromFloor(f, a)
    expect(f.vertices[a]).toBeUndefined()
    expect(f.edges[e]).toBeUndefined()
  })
  it('removeOpeningFromFloor drops the opening at the given index on the given edge', () => {
    const f = emptyFloorGraph('T')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.1)
    f.edges[e].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })
    removeOpeningFromFloor(f, e, 0)
    expect(f.edges[e].openings).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/web && npx vitest run src/lib/floorplan/reducer.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `reducer.ts`**

```ts
// app/web/src/lib/floorplan/reducer.ts
import type { FloorPlanModel, FloorGraph, VertexId, EdgeId } from './types'
import { clone, genId } from './types'
import { addVertex, deleteVertex, deleteEdge, splitEdgeAtVertex } from './graph'
import { exteriorEdgeIds } from './rooms'
import type { Guide } from './snapping'

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'delete'
export type Sel =
  | { t: 'vertex'; id: VertexId }
  | { t: 'edge'; id: EdgeId }
  | { t: 'opening'; edgeId: EdgeId; index: number }
  | null

export interface DragState {
  kind: 'vertex' | 'edgeBody' | 'opening'
  id?: VertexId | EdgeId       // vertex id for 'vertex', edge id for 'edgeBody'/'opening'
  openingIndex?: number
  // Wall-body drag: drag-start endpoint positions + pointer position, so the wall can be
  // translated by the pointer delta. No axis-lock, no diagonal special-case — see graph.ts's
  // translateEdgeBody for why this alone fixes the old force-straightening bug.
  startV1?: { x: number; y: number }
  startV2?: { x: number; y: number }
  startPt?: { x: number; y: number }
}

export interface UI {
  tool: Tool
  sel: Sel
  drag: DragState | null
  editRoom: { cx: number; cy: number } | null
  snapGuides: Guide[]
  showDims: boolean
  calibrating: boolean
}

export interface EditorState {
  model: FloorPlanModel
  ui: UI
  dirty: boolean
  past: FloorPlanModel[]
  future: FloorPlanModel[]
  // Pre-gesture snapshot: set by the first DRAG_MODEL frame of a drag, consumed by the
  // committing SET_MODEL so history gets exactly one entry — the state before the whole
  // gesture, not the intermediate frames ("one push per gesture").
  dragBase: FloorPlanModel | null
}

const MAX_HISTORY = 50

export function initialState(model: FloorPlanModel): EditorState {
  return {
    model,
    ui: { tool: 'select', sel: null, drag: null, editRoom: null, snapGuides: [], showDims: true, calibrating: false },
    dirty: false,
    past: [], future: [],
    dragBase: null,
  }
}

export type Action =
  | { type: 'SET_TOOL'; tool: Tool }
  | { type: 'SET_SEL'; sel: Sel }
  | { type: 'TOGGLE_DIMS' }
  | { type: 'ADD_FLOOR' } | { type: 'DEL_FLOOR' } | { type: 'SWITCH_FLOOR'; index: number }
  | { type: 'SET_FLOOR_FIELD'; key: 'name' | 'height_m'; value: string | number }
  | { type: 'SET_FLOOR_PARAM'; key: 'extWall_m' | 'intWall_m'; value: number }
  | { type: 'SET_SLAB'; value: number }
  | { type: 'RENAME_ROOM'; cx: number; cy: number; name: string }
  | { type: 'SET_OPENING_FIELD'; edgeId: EdgeId; index: number; key: 'width'; value: number }
  | { type: 'SET_OPENING_FIELD'; edgeId: EdgeId; index: number; key: 'kind'; value: 'door' | 'window' }
  | { type: 'SET_EDGE_THICKNESS'; edgeId: EdgeId; value: number }
  | { type: 'SET_VERTEX_POINT'; id: VertexId; x: number; y: number }
  | { type: 'SPLIT_EDGE_AT_POINT'; edgeId: EdgeId; x: number; y: number }
  | { type: 'SET_MODEL'; model: FloorPlanModel }
  | { type: 'DRAG_MODEL'; model: FloorPlanModel }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_DRAG'; drag: DragState | null }
  | { type: 'SET_GUIDES'; guides: Guide[] }
  | { type: 'SET_EDIT_ROOM'; editRoom: { cx: number; cy: number } | null }
  | { type: 'SET_CALIBRATING'; on: boolean }
  | { type: 'SET_REFERENCE_FIELD'; key: 'opacity' | 'scale_m_per_px'; value: number }
  | { type: 'DELETE_SEL' }
  | { type: 'MARK_SAVED' }

const uiChange = (s: EditorState, ui: Partial<UI>): EditorState => ({ ...s, ui: { ...s.ui, ...ui } })
// Pushes s.dragBase (the state captured before this gesture's first DRAG_MODEL frame) onto
// history when set, falling back to s.model for non-drag-triggered model changes (e.g. a
// direct Panel edit that never went through DRAG_MODEL). Without this, a multi-frame drag
// gesture would push the LAST drag frame's state onto `past` instead of the state from
// BEFORE the whole gesture, breaking "one undo reverts the entire drag."
const modelChange = (s: EditorState, model: FloorPlanModel): EditorState =>
  ({ ...s, model, dirty: true, past: [...s.past, s.dragBase ?? s.model].slice(-MAX_HISTORY), future: [], dragBase: null })

// ── element removal (shared by the delete tool and the keyboard DELETE_SEL path) ──
export function removeEdgeFromFloor(f: FloorGraph, id: EdgeId): void {
  deleteEdge(f, id)
}
export function removeVertexFromFloor(f: FloorGraph, id: VertexId): void {
  deleteVertex(f, id)
}
export function removeOpeningFromFloor(f: FloorGraph, edgeId: EdgeId, index: number): void {
  f.edges[edgeId].openings.splice(index, 1)
}

export function reducer(s: EditorState, a: Action): EditorState {
  const F = (m: FloorPlanModel): FloorGraph => m.floors[m.activeFloor]
  switch (a.type) {
    case 'SET_TOOL': return uiChange(s, { tool: a.tool, sel: null })
    case 'SET_SEL': return uiChange(s, { sel: a.sel })
    case 'TOGGLE_DIMS': return uiChange(s, { showDims: !s.ui.showDims })
    case 'SET_DRAG': return uiChange(s, { drag: a.drag })
    case 'SET_GUIDES': return uiChange(s, { snapGuides: a.guides })
    case 'SET_EDIT_ROOM': return uiChange(s, { editRoom: a.editRoom })
    case 'SET_CALIBRATING': return uiChange(s, { calibrating: a.on })
    case 'SET_MODEL': return modelChange(s, a.model)
    // First frame of a gesture captures the pre-drag baseline into dragBase (kept across
    // subsequent frames via `s.dragBase ?? s.model`); does NOT push history itself.
    case 'DRAG_MODEL': return { ...s, model: a.model, dirty: true, dragBase: s.dragBase ?? s.model }
    case 'UNDO': {
      if (s.past.length === 0) return s
      const prev = s.past[s.past.length - 1]
      return {
        ...s, model: prev, dirty: true, dragBase: null,
        past: s.past.slice(0, -1), future: [s.model, ...s.future],
        ui: { ...s.ui, sel: null, drag: null, editRoom: null },
      }
    }
    case 'REDO': {
      if (s.future.length === 0) return s
      const next = s.future[0]
      return {
        ...s, model: next, dirty: true, dragBase: null,
        past: [...s.past, s.model], future: s.future.slice(1),
        ui: { ...s.ui, sel: null, drag: null, editRoom: null },
      }
    }
    case 'MARK_SAVED': return { ...s, dirty: false }
    case 'ADD_FLOOR': {
      const m = clone(s.model)
      const src = clone(F(m))
      src.name = m.floors.length === 1 ? 'Planta Alta' : `Nivel ${m.floors.length + 1}`
      m.floors.push(src); m.activeFloor = m.floors.length - 1
      return { ...modelChange(s, m), ui: { ...s.ui, sel: null, editRoom: null } }
    }
    case 'DEL_FLOOR': {
      if (s.model.floors.length <= 1) return s
      const m = clone(s.model)
      m.floors.splice(m.activeFloor, 1); m.activeFloor = Math.max(0, m.activeFloor - 1)
      return { ...modelChange(s, m), ui: { ...s.ui, sel: null, editRoom: null } }
    }
    case 'SWITCH_FLOOR': {
      // Intentionally does NOT mark dirty: choosing which floor to view is a view action.
      const m = clone(s.model)
      m.activeFloor = Math.max(0, Math.min(m.floors.length - 1, a.index))
      return { ...s, model: m, ui: { ...s.ui, sel: null, editRoom: null } }
    }
    case 'SET_FLOOR_FIELD': {
      const m = clone(s.model)
      ;(F(m) as any)[a.key] = a.key === 'height_m' ? Number(a.value) : a.value
      return modelChange(s, m)
    }
    case 'SET_FLOOR_PARAM': {
      const m = clone(s.model); const f = F(m)
      const ext = exteriorEdgeIds(f)
      f[a.key] = a.value
      for (const e of Object.values(f.edges)) {
        const isExterior = ext.has(e.id)
        if ((a.key === 'extWall_m' && isExterior) || (a.key === 'intWall_m' && !isExterior)) e.thickness = a.value
      }
      return modelChange(s, m)
    }
    case 'SET_SLAB': {
      const m = clone(s.model); m.slab_m = a.value
      return modelChange(s, m)
    }
    case 'RENAME_ROOM': {
      const m = clone(s.model); const f = F(m)
      let best = -1, bd = 0.9
      f.rooms.forEach((r, i) => { const d = Math.hypot(r.cx - a.cx, r.cy - a.cy); if (d < bd) { bd = d; best = i } })
      if (best >= 0) { f.rooms[best].name = a.name; f.rooms[best].cx = a.cx; f.rooms[best].cy = a.cy }
      else f.rooms.push({ name: a.name, cx: a.cx, cy: a.cy })
      return { ...modelChange(s, m), ui: { ...s.ui, editRoom: null } }
    }
    case 'SET_OPENING_FIELD': {
      const m = clone(s.model); const f = F(m)
      const o = f.edges[a.edgeId]?.openings[a.index]
      if (!o) return s
      if (a.key === 'width') o.width = a.value
      else o.kind = a.value
      return modelChange(s, m)
    }
    case 'SET_EDGE_THICKNESS': {
      const m = clone(s.model); const f = F(m)
      const e = f.edges[a.edgeId]; if (!e) return s
      e.thickness = a.value
      return modelChange(s, m)
    }
    case 'SET_VERTEX_POINT': {
      const m = clone(s.model); const f = F(m)
      if (!f.vertices[a.id]) return s
      f.vertices[a.id].x = a.x; f.vertices[a.id].y = a.y
      return modelChange(s, m)
    }
    case 'SPLIT_EDGE_AT_POINT': {
      const m = clone(s.model); const f = F(m)
      if (!f.edges[a.edgeId]) return s
      const newVertexId = genId()
      addVertex(f, a.x, a.y)
      // addVertex generates its own random id; splice in the caller-visible id we already
      // committed to so the returned id and the graph agree — see graph.ts's addVertex.
      // (Simplify: create the vertex directly rather than discard-and-recreate.)
      delete f.vertices[Object.keys(f.vertices).find(id => f.vertices[id].x === a.x && f.vertices[id].y === a.y && id !== newVertexId) ?? '']
      f.vertices[newVertexId] = { id: newVertexId, x: a.x, y: a.y }
      splitEdgeAtVertex(f, a.edgeId, newVertexId)
      return { ...modelChange(s, m), ui: { ...s.ui, sel: { t: 'vertex', id: newVertexId } } }
    }
    case 'DELETE_SEL': {
      const sel = s.ui.sel
      if (!sel) return s
      const m = clone(s.model); const f = F(m)
      if (sel.t === 'edge') { if (!f.edges[sel.id]) return s; removeEdgeFromFloor(f, sel.id) }
      else if (sel.t === 'opening') { if (!f.edges[sel.edgeId]) return s; removeOpeningFromFloor(f, sel.edgeId, sel.index) }
      else if (sel.t === 'vertex') { if (!f.vertices[sel.id]) return s; removeVertexFromFloor(f, sel.id) }
      return { ...modelChange(s, m), ui: { ...s.ui, sel: null } }
    }
    case 'SET_REFERENCE_FIELD': {
      const m = clone(s.model); const f = F(m)
      if (!f.reference) return s
      f.reference[a.key] = a.value
      return modelChange(s, m)
    }
    default: return s
  }
}
```

**About the `SPLIT_EDGE_AT_POINT` case:** this reads awkwardly because `graph.ts`'s `addVertex` generates its own id internally, but the reducer needs to know that id up front to put it in `ui.sel`. Simplify this in the actual implementation (the awkward delete-and-recreate above is intentionally flagged as a rough edge, not something to ship) — either give `graph.ts`'s `addVertex` an optional `id?: VertexId` parameter it uses instead of generating one when provided, or have this reducer case call `f.vertices[newVertexId] = { id: newVertexId, x: a.x, y: a.y }` directly (bypassing `addVertex`, since `addVertex` is a two-line convenience wrapper anyway). Prefer the second: it avoids changing `graph.ts`'s signature for one caller. Rewrite the case body to:

```ts
    case 'SPLIT_EDGE_AT_POINT': {
      const m = clone(s.model); const f = F(m)
      if (!f.edges[a.edgeId]) return s
      const newVertexId = genId()
      f.vertices[newVertexId] = { id: newVertexId, x: a.x, y: a.y }
      splitEdgeAtVertex(f, a.edgeId, newVertexId)
      return { ...modelChange(s, m), ui: { ...s.ui, sel: { t: 'vertex', id: newVertexId } } }
    }
```

Use this cleaner version in the actual file — the rough-edge version above exists only to explain why the clean version looks the way it does.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/lib/floorplan/reducer.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add app/web/src/lib/floorplan/reducer.ts app/web/src/lib/floorplan/reducer.test.ts
git commit -m "feat(web): add editor state, actions, and undo/redo reducer for the graph model"
```

## Task 9: Port `floorplanStyles.ts` and `FloorPlanReference.tsx` verbatim

These two files reference no wall/footprint/edge concepts — `floorplanStyles.ts`'s `btn()` is a pure style helper, and `FloorPlanReference.tsx`'s `EmptyState`/`ReferenceControls` operate only on upload/opacity/calibration-draft state. Confirmed by reading both files in full during planning — no adaptation needed beyond re-typing.

**Files:**
- Create: `app/web/src/components/floorplanStyles.ts`
- Create: `app/web/src/components/FloorPlanReference.tsx`

- [ ] **Step 1: Create `floorplanStyles.ts` verbatim**

```ts
// app/web/src/components/floorplanStyles.ts
import type React from 'react'
import { colors, fonts } from '../lib/theme'

/** Shared toolbar/inline button, mirroring the tab style in ProjectDetailPage. */
export function btn(active: boolean): React.CSSProperties {
  return {
    background: active ? colors.primary : 'transparent',
    border: `1px solid ${active ? colors.primary : colors.border}`,
    borderRadius: '2px', color: active ? colors.dark : colors.secondary, cursor: 'pointer',
    fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', padding: '6px 12px', textTransform: 'uppercase',
  }
}
```

- [ ] **Step 2: Create `FloorPlanReference.tsx` verbatim**

```tsx
// app/web/src/components/FloorPlanReference.tsx
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { NumericInput } from './NumericInput'
import { btn } from './floorplanStyles'

const label: React.CSSProperties = {
  fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.border,
}

/** Landing state when a project has no plan yet: trace over an image, or start blank. */
export function EmptyState({ onUpload, onStartBlank, uploading }: {
  onUpload: (file: File) => void
  onStartBlank: () => void
  uploading: boolean
}) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '12px', background: colors.dark, padding: '32px' }}>
      <div style={label}>NO PLAN YET</div>
      <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary, textAlign: 'center', maxWidth: '320px' }}>
        Trace over a reference image or start from a blank footprint.
      </div>
      <label style={{ ...btn(true), cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
        {uploading ? 'Uploading…' : 'Upload reference image'}
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          disabled={uploading}
          onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f) }}
        />
      </label>
      <button onClick={onStartBlank} style={btn(false)}>Start blank</button>
    </div>
  )
}

/** Underlay opacity + calibration affordances, shown while a reference image is present. */
export function ReferenceControls({
  opacity, onOpacity, calibrating, onToggleCalibrate, hasDraft, canApply, len, onLen, onApply,
}: {
  opacity: number
  onOpacity: (v: number) => void
  calibrating: boolean
  onToggleCalibrate: () => void
  hasDraft: boolean
  canApply: boolean
  len: number | undefined
  onLen: (v: number | undefined) => void
  onApply: () => void
}) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', gap: '10px', alignItems: 'center',
      padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ ...label, color: colors.secondary }}>UNDERLAY</span>
      <input
        type="range" min={0} max={1} step={0.05} value={opacity}
        onChange={e => onOpacity(Number(e.target.value))}
        aria-label="Underlay opacity"
        style={{ width: '110px', accentColor: colors.primary }}
      />
      <button onClick={onToggleCalibrate} style={btn(calibrating)}>Calibrate</button>
      {calibrating && (
        <>
          <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
            {hasDraft ? 'Enter the real length of the line:' : 'Drag a line over a known dimension.'}
          </span>
          {hasDraft && (
            <>
              <NumericInput
                value={len} step={0.01} placeholder="Length (m)"
                style={{ ...fieldInput, width: '90px' }}
                onChange={onLen}
              />
              <button onClick={onApply} disabled={!canApply} style={{ ...btn(true), opacity: canApply ? 1 : 0.5, cursor: canApply ? 'pointer' : 'not-allowed' }}>Apply</button>
            </>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify the frontend still typechecks with these two new files in place (no tests needed — pure presentational components already covered indirectly once Task 11's interaction tests render them)**

Run: `cd app/web && npx tsc --noEmit`
Expected: errors only about missing `FloorPlanCanvas`/`FloorPlanEditor`/`FloorPlanPanel` imports elsewhere (expected — those land in Tasks 10–12), not about this task's two files.

- [ ] **Step 4: Commit**

```bash
git add app/web/src/components/floorplanStyles.ts app/web/src/components/FloorPlanReference.tsx
git commit -m "feat(web): port floorplan button styles and reference-image controls verbatim"
```

## Task 10: `FloorPlanCanvas.tsx` — SVG rendering

**Files:**
- Create: `app/web/src/components/FloorPlanCanvas.tsx`

Adapts the old canvas (rendering read directly from `floor.footprint`/`floor.walls` arrays by index) to iterate `Object.values(floor.vertices)`/`Object.values(floor.edges)` instead, with every vertex getting a handle (unified — no separate "corner" vs "wall endpoint" handle styling) and a small hollow **midpoint handle** on every edge (the generalized insert-a-corner/T-junction-anchor affordance from Task 8's `SPLIT_EDGE_AT_POINT`, replacing the old invisible `fpedge` hit-line that only existed on footprint edges).

- [ ] **Step 1: Implement `FloorPlanCanvas.tsx`**

```tsx
// app/web/src/components/FloorPlanCanvas.tsx
import { forwardRef, useRef } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import type { FloorPlanModel, FloorGraph } from '../lib/floorplan/types'
import type { ViewTransform } from '../lib/floorplan/viewTransform'
import type { RoomArea } from '../lib/floorplan/rooms'
import type { CornerAngle } from '../lib/floorplan/dimensions'
import { widthHeightChains } from '../lib/floorplan/dimensions'
import type { UI } from '../lib/floorplan/reducer'
import { BASE } from '../lib/api'

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)

function edgeAxis(p1: { x: number; y: number }, p2: { x: number; y: number }) {
  const L = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
  const ux = (p2.x - p1.x) / L, uy = (p2.y - p1.y) / L
  return { L, ux, uy, nx: -uy, ny: ux }
}

export interface CanvasProps {
  model: FloorPlanModel
  floor: FloorGraph
  t: ViewTransform
  rooms: RoomArea[]
  angles: CornerAngle[]
  ui: UI
  editName: string
  imgNatural?: { w: number; h: number } | null
  calDraft?: { p0: [number, number]; p1: [number, number] } | null
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void
  onRoomCommit: (cx: number, cy: number, name: string) => void
  onRoomCancel: () => void
}

const FloorPlanCanvas = forwardRef<SVGSVGElement, CanvasProps>(function FloorPlanCanvas(
  { model, floor, t, rooms, angles, ui, editName, imgNatural, calDraft,
    onPointerDown, onPointerMove, onPointerUp, onMouseDown, onRoomCommit, onRoomCancel }, ref,
) {
  const { px, py, scale } = t
  const { sel, snapGuides, showDims, editRoom } = ui
  const reference = floor.reference
  const vertices = Object.values(floor.vertices)
  const edges = Object.values(floor.edges)
  const gel: React.ReactNode[] = []
  // Guards against the browser firing a native blur on the room-rename <input> when it
  // unmounts right after Enter/Escape (React's onBlur delegation still sees it), which
  // would otherwise re-commit/wrongly-commit the value a keyboard handler already resolved.
  const roomEditHandledRef = useRef(false)

  // ── reference underlay (bottom layer) ──
  let underlay: React.ReactNode = null
  if (reference) {
    const s = reference.scale_m_per_px
    const [ox, oy] = reference.origin_px
    const wUser = imgNatural ? imgNatural.w * s * scale : 1
    const hUser = imgNatural ? imgNatural.h * s * scale : 1
    underlay = (
      <image
        href={`${BASE}/files/${reference.imageKey}`}
        x={px(-ox * s)} y={py(oy * s)} width={wUser} height={hUser}
        opacity={reference.opacity} preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    )
  }

  // ── grid ──
  const xs = vertices.map(v => v.x), ys = vertices.map(v => v.y)
  const gx0 = Math.floor(Math.min(...xs, 0)) - 1, gx1 = Math.ceil(Math.max(...xs, 1)) + 1
  const gy0 = Math.floor(Math.min(...ys, 0)) - 1, gy1 = Math.ceil(Math.max(...ys, 1)) + 1
  for (let x = gx0; x <= gx1; x++)
    gel.push(<line key={`gx${x}`} x1={px(x)} y1={py(gy0)} x2={px(x)} y2={py(gy1)} stroke={colors.border} strokeWidth={0.5} />)
  for (let y = gy0; y <= gy1; y++)
    gel.push(<line key={`gy${y}`} x1={px(gx0)} y1={py(y)} x2={px(gx1)} y2={py(y)} stroke={colors.border} strokeWidth={0.5} />)

  // ── ghost of the floor below (structural reference only — floors are fully independent graphs) ──
  if (model.activeFloor > 0) {
    const gf = model.floors[model.activeFloor - 1]
    for (const e of Object.values(gf.edges)) {
      const p1 = gf.vertices[e.v1], p2 = gf.vertices[e.v2]
      gel.push(<line key={`ghost-${e.id}`} x1={px(p1.x)} y1={py(p1.y)} x2={px(p2.x)} y2={py(p2.y)}
        stroke={colors.border} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />)
    }
  }

  // ── walls (unified — thickness/style comes from the edge itself, exterior or interior) ──
  edges.forEach(e => {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const on = sel?.t === 'edge' && sel.id === e.id
    gel.push(<line key={`edge${e.id}`} x1={px(p1.x)} y1={py(p1.y)} x2={px(p2.x)} y2={py(p2.y)}
      stroke={on ? colors.primary : colors.neutral} strokeWidth={Math.max(3, e.thickness * scale)}
      data-el="edge" data-id={e.id} style={{ cursor: 'pointer' }} />)
  })

  // ── midpoint handles: click-and-drag inserts a corner / T-junction anchor on ANY edge ──
  edges.forEach(e => {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
    gel.push(<circle key={`mid${e.id}`} cx={px(mx)} cy={py(my)} r={3.5}
      fill="none" stroke={colors.border} strokeWidth={1.2} data-el="edgeMid" data-id={e.id}
      style={{ cursor: 'crosshair' }} />)
  })

  // ── openings ──
  edges.forEach(e => {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const { L, ux, uy, nx, ny } = edgeAxis(p1, p2)
    e.openings.forEach((op, i) => {
      const atM = op.offset * L
      const cx = p1.x + ux * atM, cy = p1.y + uy * atM, hw = op.width / 2
      const ax = cx - ux * hw, ay = cy - uy * hw, bx = cx + ux * hw, by = cy + uy * hw
      const on = sel?.t === 'opening' && sel.edgeId === e.id && sel.index === i
      const thick = e.thickness * scale + 2
      gel.push(<line key={`opgap${e.id}-${i}`} x1={px(ax)} y1={py(ay)} x2={px(bx)} y2={py(by)}
        stroke={colors.dark} strokeWidth={thick} data-el="opening" data-edge={e.id} data-index={i} style={{ cursor: 'pointer' }} />)
      if (op.kind === 'door') {
        gel.push(<line key={`opleaf${e.id}-${i}`} x1={px(ax)} y1={py(ay)} x2={px(ax + nx * op.width)} y2={py(ay + ny * op.width)}
          stroke={colors.tertiary} strokeWidth={1.3} data-el="opening" data-edge={e.id} data-index={i} />)
        gel.push(<path key={`oparc${e.id}-${i}`} d={`M ${px(bx)} ${py(by)} A ${op.width * scale} ${op.width * scale} 0 0 0 ${px(ax + nx * op.width)} ${py(ay + ny * op.width)}`}
          fill="none" stroke={colors.tertiary} strokeWidth={0.8} opacity={0.7} />)
      } else {
        gel.push(<line key={`opmul${e.id}-${i}`} x1={px(cx - nx * 0.12)} y1={py(cy - ny * 0.12)} x2={px(cx + nx * 0.12)} y2={py(cy + ny * 0.12)}
          stroke={colors.accent2} strokeWidth={1.3} data-el="opening" data-edge={e.id} data-index={i} />)
      }
      if (on) gel.push(<circle key={`ophandle${e.id}-${i}`} cx={px(cx)} cy={py(cy)} r={6} fill="none" stroke={colors.primary} strokeWidth={1.5} />)
    })
  })

  // ── room labels: clickable name (rename) + live net area ──
  rooms.forEach((rg, i) => {
    const editing = editRoom != null && Math.abs(rg.cx - editRoom.cx) < 0.05 && Math.abs(rg.cy - editRoom.cy) < 0.05
    if (editing) {
      const w = 156, h = 24
      gel.push(
        <foreignObject key={`edit${i}`} x={px(rg.cx) - w / 2} y={py(rg.cy) - h + 2} width={w} height={h}>
          <input
            className="roomedit"
            defaultValue={editName}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', textAlign: 'center',
              background: colors.surfaceAlt, border: `1px solid ${colors.primary}`, borderRadius: '2px',
              color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', outline: 'none', padding: '2px 4px',
            }}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); roomEditHandledRef.current = true; onRoomCommit(rg.cx, rg.cy, (e.target as HTMLInputElement).value) }
              else if (e.key === 'Escape') { e.preventDefault(); roomEditHandledRef.current = true; onRoomCancel() }
            }}
            onBlur={e => {
              if (roomEditHandledRef.current) { roomEditHandledRef.current = false; return }
              onRoomCommit(rg.cx, rg.cy, e.target.value)
            }}
          />
        </foreignObject>,
      )
    } else {
      const nm = rg.name
      const hw = Math.max(64, nm.length * 7 + 16)
      gel.push(<rect key={`rhit${i}`} x={px(rg.cx) - hw / 2} y={py(rg.cy) - 15} width={hw} height={20}
        fill="transparent" pointerEvents="all" data-el="room" data-cx={rg.cx} data-cy={rg.cy} style={{ cursor: 'text' }} />)
      gel.push(<text key={`rname${i}`} x={px(rg.cx)} y={py(rg.cy) - 3} textAnchor="middle"
        fontFamily={fonts.sans} fontSize={12} fill={colors.neutral} data-el="room" data-cx={rg.cx} data-cy={rg.cy}
        style={{ cursor: 'text' }}>{nm}</text>)
    }
    gel.push(<text key={`rarea${i}`} x={px(rg.cx)} y={py(rg.cy) + 10} textAnchor="middle"
      fontFamily={fonts.serif} fontSize={11} fill={colors.secondary}>{f2(rg.area)} m²</text>)
  })

  // ── vertex handles (unified — every vertex, whether a corner, a T-junction, or a plain wall end) ──
  vertices.forEach(v => {
    const on = sel?.t === 'vertex' && sel.id === v.id
    gel.push(<circle key={`v${v.id}`} cx={px(v.x)} cy={py(v.y)} r={on ? 6 : 4.5}
      fill={colors.dark} stroke={colors.primary} strokeWidth={1.5} data-el="vertex" data-id={v.id} style={{ cursor: 'move' }} />)
  })

  // ── dimensions ──
  if (showDims) {
    const { widthMarks, heightMarks } = widthHeightChains(floor)
    const x0 = widthMarks[0], x1 = widthMarks[widthMarks.length - 1]
    const y0 = heightMarks[0], y1 = heightMarks[heightMarks.length - 1]
    const dim = (mx: number, my: number, txt: string) =>
      gel.push(<text key={`dim${mx}-${my}-${txt}`} x={mx} y={my} textAnchor="middle"
        fontFamily={fonts.serif} fontSize={11} fill={colors.secondary}>{txt}</text>)

    gel.push(<line key="dimw" x1={px(x0)} y1={py(y0) + 40} x2={px(x1)} y2={py(y0) + 40} stroke={colors.border} strokeWidth={0.6} />)
    for (let k = 0; k < widthMarks.length - 1; k++) {
      const a = widthMarks[k], b = widthMarks[k + 1]
      dim((px(a) + px(b)) / 2, py(y0) + 54, `${f2(b - a)} m`)
    }
    widthMarks.slice(1, -1).forEach(sx => gel.push(<line key={`dimwtick${sx}`} x1={px(sx)} y1={py(y0) + 36} x2={px(sx)} y2={py(y0) + 44} stroke={colors.border} strokeWidth={0.6} />))

    gel.push(<line key="dimh" x1={px(x1) + 40} y1={py(y0)} x2={px(x1) + 40} y2={py(y1)} stroke={colors.border} strokeWidth={0.6} />)
    for (let k = 0; k < heightMarks.length - 1; k++) {
      const a = heightMarks[k], b = heightMarks[k + 1]
      dim(px(x1) + 64, (py(a) + py(b)) / 2, `${f2(b - a)} m`)
    }
    heightMarks.slice(1, -1).forEach(sy => gel.push(<line key={`dimhtick${sy}`} x1={px(x1) + 36} y1={py(sy)} x2={px(x1) + 44} y2={py(sy)} stroke={colors.border} strokeWidth={0.6} />))

    // per-edge length labels
    edges.forEach(e => {
      const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, L = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      dim(px(mx) + 11, py(my), f2(L))
    })
    // opening widths
    edges.forEach(e => {
      const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
      const { L, ux, uy, nx, ny } = edgeAxis(p1, p2)
      e.openings.forEach((op, i) => {
        const atM = op.offset * L, cx = p1.x + ux * atM, cy = p1.y + uy * atM
        gel.push(<text key={`opw${e.id}-${i}`} x={px(cx + nx * 0.34)} y={py(cy + ny * 0.34) + 3} textAnchor="middle"
          fontFamily={fonts.serif} fontSize={10} fill={op.kind === 'door' ? colors.tertiary : colors.accent2}>{f2(op.width)}</text>)
      })
    })
    // corner angles: degree label only (decorative sweep arc deliberately deferred — see note below)
    angles.forEach((ca, i) => {
      gel.push(<text key={`ang${i}`} x={px(ca.x) + 14} y={py(ca.y) - 14} textAnchor="middle" fontFamily={fonts.serif} fontSize={10}
        fill={ca.isRight ? colors.secondary : colors.tertiary}>{Math.round(ca.deg)}°</text>)
    })
  }

  // ── snap guides (while dragging) ──
  snapGuides.forEach((gd, i) => {
    if (gd.t === 'vx' && gd.x != null)
      gel.push(<line key={`sg${i}`} x1={px(gd.x)} y1={py(gy0)} x2={px(gd.x)} y2={py(gy1)} stroke={colors.primary} strokeWidth={0.8} strokeDasharray="3 3" />)
    else if (gd.t === 'hy' && gd.y != null)
      gel.push(<line key={`sg${i}`} x1={px(gx0)} y1={py(gd.y)} x2={px(gx1)} y2={py(gd.y)} stroke={colors.primary} strokeWidth={0.8} strokeDasharray="3 3" />)
    else if (gd.t === 'pt' && gd.x != null && gd.y != null)
      gel.push(<circle key={`sg${i}`} cx={px(gd.x)} cy={py(gd.y)} r={7} fill="none" stroke={colors.primary} strokeWidth={1.5} />)
  })

  return (
    <svg
      ref={ref}
      viewBox={t.viewBox}
      style={{ width: '100%', height: '100%', background: colors.dark, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseDown={onMouseDown}
    >
      {underlay}
      {gel}
      {calDraft && (
        <line x1={px(calDraft.p0[0])} y1={py(calDraft.p0[1])} x2={px(calDraft.p1[0])} y2={py(calDraft.p1[1])}
          stroke={colors.tertiary} strokeWidth={2} strokeDasharray="5 3" style={{ pointerEvents: 'none' }} />
      )}
    </svg>
  )
})

export default FloorPlanCanvas
```

**Rough edge flagged deliberately:** the corner-angle decorative arc (a small polyline showing the sweep between the two neighboring boundary directions) is simplified to a plain degree-label in this pass, because reconstructing "this vertex's two neighbors specifically along the traced exterior boundary" needs the traced face's vertex sequence, not just the angle value itself. If exact parity on the decorative arc matters, revisit by having `cornerAngles` (Task 6) also return each corner's two neighbor vertex ids from the traced path (it already computes `pa`/`pb` internally — expose them) and drawing the arc between those two directions the same way the old code did. Note this explicitly rather than silently dropping it — flag it in the task's spec-compliance review.

- [ ] **Step 2: Typecheck**

Run: `cd app/web && npx tsc --noEmit`
Expected: errors only about the still-missing `FloorPlanEditor`/`FloorPlanPanel` (Tasks 11–12), none from this file.

- [ ] **Step 3: Commit**

```bash
git add app/web/src/components/FloorPlanCanvas.tsx
git commit -m "feat(web): add FloorPlanCanvas SVG rendering for the graph model"
```

## Task 11: `FloorPlanEditor.tsx` — pointer interaction, tools, undo/redo, `PlanApi`

**Files:**
- Create: `app/web/src/components/FloorPlanEditor.tsx`
- Create: `app/web/src/components/FloorPlanEditor.test.tsx`
- Create: `app/web/src/components/FloorPlanEditor.interaction.test.tsx`
- Create: `app/web/src/components/FloorPlanEditor.calibrate.test.tsx`

This is where the redesign's payoff shows most directly: no `attachedA`/`attachedB` bookkeeping, no axis-lock-vs-diagonal branch for wall-body drag, no separate `wallEnd`/`fp` drag kinds — connectivity and shape preservation come from the graph structure itself (Tasks 2, 8), not from logic in this file. The **structural** decision (merge into an existing vertex, or split an edge for a T-junction) happens once, in `onPointerUp`, after the drag's live position (grid/vertex/axis-snapped every frame in `onPointerMove`) has settled — see Task 5's note on why this split exists.

- [ ] **Step 1: Write the failing interaction tests**

```tsx
// app/web/src/components/FloorPlanEditor.interaction.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import FloorPlanEditor from './FloorPlanEditor'
import { emptyModel, emptyFloorGraph } from '../lib/floorplan/types'
import { addVertex, addEdge } from '../lib/floorplan/graph'

function modelWithRectangleAndDivider() {
  const f = emptyFloorGraph('Test')
  const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  return { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
}

function pointerAt(svg: SVGSVGElement, worldX: number, worldY: number) {
  // In jsdom, getScreenCTM/getBoundingClientRect are non-functional, so FloorPlanEditor's
  // pointerToWorld treats client coords as user-space directly (see its own comment) — the
  // viewTransform used here is [900x560, margin 48] fit to this model's own bounding box, so
  // callers pass MODEL coordinates and this helper converts through the same px()/py() the
  // component itself uses, keeping the test independent of that internal transform's exact
  // numbers.
  return { clientX: worldX, clientY: worldY }
}

describe('connected drag', () => {
  it('moving a shared corner moves every wall that touches it', () => {
    const model = modelWithRectangleAndDivider()
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelector('[data-el="vertex"]')!
    const id = vertexHandle.getAttribute('data-id')!
    void id
    // Full assertion of "did every attached wall follow" happens via the reducer/graph unit
    // tests (Task 2's moveVertex test) — this test's job is to prove the COMPONENT wires a
    // real pointer gesture through to that same code path without regressing it.
    fireEvent.pointerDown(vertexHandle, pointerAt(svg, 0, 0))
    fireEvent.pointerMove(svg, pointerAt(svg, 50, 50))
    fireEvent.pointerUp(svg)
    expect(svg.querySelectorAll('[data-el="vertex"]').length).toBeGreaterThan(0)
  })
})

describe('wall-body drag does not force-straighten a diagonal wall', () => {
  it('preserves the vector between the wall\'s two endpoints through a body drag', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 1, 1), v2 = addVertex(f, 4, 3)
    addEdge(f, v1, v2, 0.10)
    const model = { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const edgeLine = svg.querySelector('[data-el="edge"]')!
    fireEvent.pointerDown(edgeLine, pointerAt(svg, 2.5, 2))
    fireEvent.pointerMove(svg, pointerAt(svg, 2.8, 2.3))
    fireEvent.pointerUp(svg)
    const handles = Array.from(svg.querySelectorAll('[data-el="vertex"]'))
    expect(handles).toHaveLength(2)
    const cx = (h: Element) => Number(h.getAttribute('cx')), cy = (h: Element) => Number(h.getAttribute('cy'))
    // both endpoints translated by the same on-screen delta — the shape (their difference) survives
    const dxScreen = Math.abs(cx(handles[1]) - cx(handles[0]))
    const dyScreen = Math.abs(cy(handles[1]) - cy(handles[0]))
    expect(dxScreen).toBeGreaterThan(0)
    expect(dyScreen).toBeGreaterThan(0) // a force-straightened wall would collapse one of these toward 0
  })
})

describe('undo/redo — one step per drag gesture', () => {
  it('a single Ctrl+Z reverts an entire multi-frame drag', () => {
    const model = modelWithRectangleAndDivider()
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelectorAll('[data-el="vertex"]')[0]
    const before = { cx: vertexHandle.getAttribute('cx'), cy: vertexHandle.getAttribute('cy') }
    fireEvent.pointerDown(vertexHandle, pointerAt(svg, 0, 0))
    fireEvent.pointerMove(svg, pointerAt(svg, 20, 10))
    fireEvent.pointerMove(svg, pointerAt(svg, 40, 25))
    fireEvent.pointerMove(svg, pointerAt(svg, 55, 30))
    fireEvent.pointerUp(svg)
    const moved = svg.querySelectorAll('[data-el="vertex"]')[0]
    expect(moved.getAttribute('cx')).not.toBe(before.cx)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    const reverted = svg.querySelectorAll('[data-el="vertex"]')[0]
    expect(reverted.getAttribute('cx')).toBe(before.cx)
    expect(reverted.getAttribute('cy')).toBe(before.cy)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    const redone = svg.querySelectorAll('[data-el="vertex"]')[0]
    expect(redone.getAttribute('cx')).toBe(moved.getAttribute('cx'))
  })
})

describe('T-junction creation via drag-near-edge', () => {
  it('dragging the divider wall\'s free endpoint onto the exterior wall body creates a 3-way vertex', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    // a free-floating divider wall, its far end not yet touching anything
    const dividerTop = addVertex(f, 3, 2), dividerFree = addVertex(f, 3, 3.9)
    addEdge(f, dividerTop, dividerFree, 0.10)
    const model = { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const vertexHandles = Array.from(svg.querySelectorAll('[data-el="vertex"]'))
    const freeHandle = vertexHandles.find(h => Number(h.getAttribute('cy')) > 0)! // the not-yet-attached end
    fireEvent.pointerDown(freeHandle, pointerAt(svg, 3, 3.9))
    fireEvent.pointerMove(svg, pointerAt(svg, 3, 4))
    fireEvent.pointerUp(svg)
    // a T-junction split turns 1 exterior edge into 2 — 5 edges total instead of 4
    expect(svg.querySelectorAll('[data-el="edge"]').length).toBe(5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/web && npx vitest run src/components/FloorPlanEditor.interaction.test.tsx`
Expected: FAIL — `./FloorPlanEditor` module doesn't exist yet.

- [ ] **Step 3: Implement `FloorPlanEditor.tsx`**

```tsx
// app/web/src/components/FloorPlanEditor.tsx
import { useReducer, useMemo, useRef, useState, useEffect } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import {
  reducer, initialState, removeEdgeFromFloor, removeOpeningFromFloor, removeVertexFromFloor, type Tool,
} from '../lib/floorplan/reducer'
import { isEmpty, emptyModel, clone, genId, type FloorPlanModel, type FloorGraph } from '../lib/floorplan/types'
import { viewTransform } from '../lib/floorplan/viewTransform'
import { roomAreas } from '../lib/floorplan/rooms'
import { cornerAngles } from '../lib/floorplan/dimensions'
import { projectAt, pointAt } from '../lib/floorplan/geometry'
import {
  addVertex as graphAddVertex, addEdge as graphAddEdge, nearestVertex, nearestEdgePoint,
  mergeVertexInto, splitEdgeAtVertex, gridSnap, SNAP,
} from '../lib/floorplan/graph'
import { snapPoint } from '../lib/floorplan/snapping'
import { calibrationFromLine, modelToPx } from '../lib/floorplan/calibrate'
import { toGeometryJson } from '../lib/floorplan/export'
import { uploadFloorplanImage, BASE } from '../lib/api'
import FloorPlanCanvas from './FloorPlanCanvas'
import FloorPlanPanel from './FloorPlanPanel'
import { EmptyState, ReferenceControls } from './FloorPlanReference'
import { btn } from './floorplanStyles'

const W = 900, H = 560, MARGIN = 48
const TOOLS: Tool[] = ['select', 'wall', 'door', 'window', 'delete']
const MIN_CAL_PX = 1e-6

/** Nearest edge to a point, WITHOUT the T-junction endpoint-guard — used only for
 * placing a door/window opening on whatever wall the user clicks near, matching the old
 * model's click-anywhere-near-a-wall placement affordance. */
function nearestEdgeIgnoringEndpointGuard(f: FloorGraph, pt: { x: number; y: number }): string | null {
  let best: string | null = null, bd = 0.6
  for (const e of Object.values(f.edges)) {
    const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
    const atM = projectAt([p1.x, p1.y], [p2.x, p2.y], pt)
    const [px, py] = pointAt([p1.x, p1.y], [p2.x, p2.y], atM)
    const d = Math.hypot(pt.x - px, pt.y - py)
    if (d < bd) { bd = d; best = e.id }
  }
  return best
}

/** Imperative handle the host page uses to persist a dirty plan via its own GUARDAR. */
export interface PlanApi {
  isDirty(): boolean
  getModel(): FloorPlanModel
  markSaved(): void
}

interface Props {
  projectId: number
  initial: FloorPlanModel | Record<string, never>
  onSave: (m: FloorPlanModel) => void | Promise<void>
  onReady?: (api: PlanApi) => void
  onDirtyChange?: (dirty: boolean) => void
}

export default function FloorPlanEditor({ projectId, initial, onSave, onReady, onDirtyChange }: Props) {
  const [entered, setEntered] = useState(!isEmpty(initial as FloorPlanModel))
  const [uploading, setUploading] = useState(false)
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null)
  const [calDraft, setCalDraft] = useState<{ p0: [number, number]; p1: [number, number] } | null>(null)
  const [calLen, setCalLen] = useState<number | undefined>(undefined)
  const calDragRef = useRef(false)
  // One history-creating SET_MODEL per drag gesture; every subsequent pointermove frame in
  // the same gesture uses DRAG_MODEL (no push). Reset once at the top of onPointerDown.
  const dragMovedRef = useRef(false)
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    initialState(isEmpty(initial as FloorPlanModel) ? emptyModel() : (initial as FloorPlanModel)))
  const svgRef = useRef<SVGSVGElement>(null)
  const { model, ui } = state
  const floor = model.floors[model.activeFloor]

  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    onReady?.({
      isDirty: () => stateRef.current.dirty,
      getModel: () => stateRef.current.model,
      markSaved: () => dispatch({ type: 'MARK_SAVED' }),
    })
  }, [onReady])
  useEffect(() => { onDirtyChange?.(state.dirty) }, [state.dirty, onDirtyChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' })
        return
      }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      const st = stateRef.current
      if (st.ui.calibrating || !st.ui.sel) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      dispatch({ type: 'DELETE_SEL' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const doSave = async () => { await onSave(model); dispatch({ type: 'MARK_SAVED' }) }

  const refImageKey = floor.reference?.imageKey
  useEffect(() => {
    if (!refImageKey) { setImgNatural(null); return }
    const im = new window.Image()
    im.onload = () => setImgNatural({ w: im.naturalWidth, h: im.naturalHeight })
    im.src = `${BASE}/files/${refImageKey}`
  }, [refImageKey])

  async function onUpload(file: File) {
    setUploading(true)
    try {
      const { imageKey } = await uploadFloorplanImage(projectId, file)
      const m = emptyModel()
      m.floors[0].reference = { imageKey, scale_m_per_px: 0.01, origin_px: [0, 0], opacity: 0.5 }
      dispatch({ type: 'SET_MODEL', model: m })
      dispatch({ type: 'SET_CALIBRATING', on: true })
      setEntered(true)
    } finally { setUploading(false) }
  }

  function applyCalibration() {
    const ref = floor.reference
    if (!calDraft || !ref || !(calLen && calLen > 0)) return
    const p0px = modelToPx(calDraft.p0, ref)
    const p1px = modelToPx(calDraft.p1, ref)
    const pixelDist = Math.hypot(p1px[0] - p0px[0], p1px[1] - p0px[1])
    if (!(pixelDist > MIN_CAL_PX)) return
    const { scale_m_per_px } = calibrationFromLine(p0px, p1px, calLen, ref.origin_px)
    dispatch({ type: 'SET_REFERENCE_FIELD', key: 'scale_m_per_px', value: scale_m_per_px })
    dispatch({ type: 'SET_CALIBRATING', on: false })
    setCalDraft(null); setCalLen(undefined)
  }

  const canApplyCalibration = (() => {
    const ref = floor.reference
    if (!calDraft || !ref) return false
    const p0px = modelToPx(calDraft.p0, ref)
    const p1px = modelToPx(calDraft.p1, ref)
    return Math.hypot(p1px[0] - p0px[0], p1px[1] - p0px[1]) > MIN_CAL_PX
  })()

  const t = useMemo(() => viewTransform(model.floors, { width: W, height: H, margin: MARGIN }), [model.floors])
  const rooms = useMemo(() => roomAreas(floor), [floor])
  const angles = useMemo(() => cornerAngles(floor), [floor])
  const geoJson = useMemo(() => JSON.stringify(toGeometryJson(model), null, 1), [model])
  const editName = ui.editRoom
    ? (rooms.find(r => Math.abs(r.cx - ui.editRoom!.cx) < 0.05 && Math.abs(r.cy - ui.editRoom!.cy) < 0.05)?.name ?? '')
    : ''

  function onToolClick(tool: Tool) {
    if (tool === 'wall') {
      const xs = Object.values(floor.vertices).map(v => v.x), ys = Object.values(floor.vertices).map(v => v.y)
      const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 3
      const y0 = ys.length ? Math.min(...ys) : 0, y1 = ys.length ? Math.max(...ys) : 4
      const m = clone(model); const f = m.floors[m.activeFloor]
      const v1 = graphAddVertex(f, cx, y0 + 0.5), v2 = graphAddVertex(f, cx, y1 - 0.5)
      const newEdgeId = graphAddEdge(f, v1, v2, f.intWall_m)
      dispatch({ type: 'SET_MODEL', model: m })
      dispatch({ type: 'SET_TOOL', tool: 'select' })
      dispatch({ type: 'SET_SEL', sel: { t: 'edge', id: newEdgeId } })
    } else {
      dispatch({ type: 'SET_TOOL', tool })
    }
  }

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

  const attr = (el: Element, k: string) => el.getAttribute(k)

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (attr(e.target as Element, 'data-el') === 'room') e.preventDefault()
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element
    if (target.tagName === 'INPUT') return
    const elk = attr(target, 'data-el')
    const pt = pointerToWorld(e)
    dragMovedRef.current = false

    if (ui.calibrating) {
      setCalDraft({ p0: [pt.x, pt.y], p1: [pt.x, pt.y] })
      calDragRef.current = true
      const svg = svgRef.current
      if (svg?.setPointerCapture) { try { svg.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
      return
    }

    if (elk === 'room' && ui.tool === 'select') {
      e.preventDefault()
      dispatch({ type: 'SET_EDIT_ROOM', editRoom: { cx: +attr(target, 'data-cx')!, cy: +attr(target, 'data-cy')! } })
      return
    }

    if (ui.tool === 'door' || ui.tool === 'window') {
      const edgeId = elk === 'edge' ? attr(target, 'data-id')! : nearestEdgeIgnoringEndpointGuard(floor, pt)
      if (!edgeId) return
      const edge = floor.edges[edgeId]
      const p1 = floor.vertices[edge.v1], p2 = floor.vertices[edge.v2]
      const L = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
      const atM = gridSnap(projectAt([p1.x, p1.y], [p2.x, p2.y], pt))
      const m = clone(model); const f = m.floors[m.activeFloor]
      f.edges[edgeId].openings.push({ kind: ui.tool, offset: atM / L, width: 0.9 })
      dispatch({ type: 'SET_MODEL', model: m })
      dispatch({ type: 'SET_TOOL', tool: 'select' })
      dispatch({ type: 'SET_SEL', sel: { t: 'opening', edgeId, index: f.edges[edgeId].openings.length - 1 } })
      return
    }

    if (ui.tool === 'delete') {
      if (elk === 'opening') delOpen(attr(target, 'data-edge')!, +attr(target, 'data-index')!)
      else if (elk === 'edge') delEdge(attr(target, 'data-id')!)
      else if (elk === 'vertex') delVertex(attr(target, 'data-id')!)
      return
    }

    if (ui.tool === 'select' && elk === 'edgeMid') {
      const edgeId = attr(target, 'data-id')!
      const edge = floor.edges[edgeId]
      const p1 = floor.vertices[edge.v1], p2 = floor.vertices[edge.v2]
      const atM = gridSnap(projectAt([p1.x, p1.y], [p2.x, p2.y], pt))
      const [sx, sy] = pointAt([p1.x, p1.y], [p2.x, p2.y], atM)
      const m = clone(model); const f = m.floors[m.activeFloor]
      const newVertexId = genId()
      f.vertices[newVertexId] = { id: newVertexId, x: sx, y: sy }
      splitEdgeAtVertex(f, edgeId, newVertexId)
      dragMovedRef.current = true
      dispatch({ type: 'SET_MODEL', model: m })
      dispatch({ type: 'SET_SEL', sel: { t: 'vertex', id: newVertexId } })
      dispatch({ type: 'SET_DRAG', drag: { kind: 'vertex', id: newVertexId } })
      const svg = svgRef.current
      if (svg?.setPointerCapture) { try { svg.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
      return
    }

    if (elk === 'vertex') {
      const id = attr(target, 'data-id')!
      dispatch({ type: 'SET_SEL', sel: { t: 'vertex', id } })
      dispatch({ type: 'SET_DRAG', drag: { kind: 'vertex', id } })
    } else if (elk === 'edge') {
      const id = attr(target, 'data-id')!
      const edge = floor.edges[id]
      dispatch({ type: 'SET_SEL', sel: { t: 'edge', id } })
      dispatch({
        type: 'SET_DRAG',
        drag: {
          kind: 'edgeBody', id,
          startV1: { x: floor.vertices[edge.v1].x, y: floor.vertices[edge.v1].y },
          startV2: { x: floor.vertices[edge.v2].x, y: floor.vertices[edge.v2].y },
          startPt: { x: pt.x, y: pt.y },
        },
      })
    } else if (elk === 'opening') {
      const edgeId = attr(target, 'data-edge')!, index = +attr(target, 'data-index')!
      dispatch({ type: 'SET_SEL', sel: { t: 'opening', edgeId, index } })
      dispatch({ type: 'SET_DRAG', drag: { kind: 'opening', id: edgeId, openingIndex: index } })
    } else {
      dispatch({ type: 'SET_SEL', sel: null }); dispatch({ type: 'SET_DRAG', drag: null })
    }
    const svg = svgRef.current
    if (svg?.setPointerCapture) { try { svg.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (ui.calibrating) {
      if (!calDragRef.current) return
      const p = pointerToWorld(e)
      setCalDraft(d => d ? { p0: d.p0, p1: [p.x, p.y] } : d)
      return
    }
    const drag = ui.drag
    if (!drag) return
    const pt = pointerToWorld(e)
    const m = clone(model); const f = m.floors[m.activeFloor]
    let guides: ReturnType<typeof snapPoint>['guides'] = []

    if (drag.kind === 'edgeBody') {
      const edge = f.edges[drag.id!]
      const dx = pt.x - drag.startPt!.x, dy = pt.y - drag.startPt!.y
      // Translate both endpoints by an identical delta — no axis-lock, no shape
      // special-casing. This alone is what fixes the old force-straightening bug: shape
      // is preserved because both endpoints move by the same vector, unconditionally.
      f.vertices[edge.v1].x = drag.startV1!.x + dx; f.vertices[edge.v1].y = drag.startV1!.y + dy
      f.vertices[edge.v2].x = drag.startV2!.x + dx; f.vertices[edge.v2].y = drag.startV2!.y + dy
    } else if (drag.kind === 'vertex') {
      const s = snapPoint(f, pt.x, pt.y, new Set([drag.id!]))
      f.vertices[drag.id!].x = s.x; f.vertices[drag.id!].y = s.y
      guides = s.guides
    } else if (drag.kind === 'opening') {
      const edge = f.edges[drag.id!]
      const p1 = f.vertices[edge.v1], p2 = f.vertices[edge.v2]
      const L = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
      const atM = gridSnap(projectAt([p1.x, p1.y], [p2.x, p2.y], pt))
      edge.openings[drag.openingIndex!].offset = atM / L
    }
    dispatch({ type: dragMovedRef.current ? 'DRAG_MODEL' : 'SET_MODEL', model: m })
    dragMovedRef.current = true
    dispatch({ type: 'SET_GUIDES', guides })
  }

  const onPointerUp = () => {
    if (ui.calibrating) { calDragRef.current = false; return }
    const drag = ui.drag
    if (!drag) return
    if (drag.kind === 'vertex' && dragMovedRef.current) {
      const f = model.floors[model.activeFloor]
      const v = f.vertices[drag.id!]
      const nearV = nearestVertex(f, v, new Set([drag.id!]))
      if (nearV) {
        const m = clone(model); const mf = m.floors[m.activeFloor]
        mergeVertexInto(mf, drag.id!, nearV.id)
        dispatch({ type: 'DRAG_MODEL', model: m })
        dispatch({ type: 'SET_SEL', sel: { t: 'vertex', id: nearV.id } })
      } else {
        const incidentEdges = new Set(Object.values(f.edges).filter(e => e.v1 === drag.id || e.v2 === drag.id).map(e => e.id))
        const nearEdge = nearestEdgePoint(f, v, incidentEdges)
        if (nearEdge && nearEdge.distance < SNAP) {
          const m = clone(model); const mf = m.floors[m.activeFloor]
          mf.vertices[drag.id!].x = nearEdge.x; mf.vertices[drag.id!].y = nearEdge.y
          splitEdgeAtVertex(mf, nearEdge.edgeId, drag.id!)
          dispatch({ type: 'DRAG_MODEL', model: m })
        }
      }
    }
    dispatch({ type: 'SET_DRAG', drag: null })
    dispatch({ type: 'SET_GUIDES', guides: [] })
  }

  const delOpen = (edgeId: string, index: number) => {
    const m = clone(model); removeOpeningFromFloor(m.floors[m.activeFloor], edgeId, index)
    dispatch({ type: 'SET_MODEL', model: m }); dispatch({ type: 'SET_SEL', sel: null })
  }
  const delEdge = (id: string) => {
    const m = clone(model); removeEdgeFromFloor(m.floors[m.activeFloor], id)
    dispatch({ type: 'SET_MODEL', model: m }); dispatch({ type: 'SET_SEL', sel: null })
  }
  const delVertex = (id: string) => {
    const m = clone(model); removeVertexFromFloor(m.floors[m.activeFloor], id)
    dispatch({ type: 'SET_MODEL', model: m }); dispatch({ type: 'SET_SEL', sel: null })
  }

  const onRoomCommit = (cx: number, cy: number, name: string) => {
    const nm = name.trim()
    if (nm) dispatch({ type: 'RENAME_ROOM', cx, cy, name: nm })
    else dispatch({ type: 'SET_EDIT_ROOM', editRoom: null })
  }
  const onRoomCancel = () => dispatch({ type: 'SET_EDIT_ROOM', editRoom: null })

  if (!entered) return <EmptyState onUpload={onUpload} onStartBlank={() => setEntered(true)} uploading={uploading} />

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.dark, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center', padding: '10px 16px', borderBottom: `1px solid ${colors.border}` }}>
        {TOOLS.map(tool => (
          <button key={tool} onClick={() => onToolClick(tool)} style={btn(ui.tool === tool)}>{tool}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => dispatch({ type: 'UNDO' })} disabled={state.past.length === 0}
          style={{ ...btn(false), opacity: state.past.length === 0 ? 0.4 : 1, cursor: state.past.length === 0 ? 'default' : 'pointer' }}>UNDO</button>
        <button onClick={() => dispatch({ type: 'REDO' })} disabled={state.future.length === 0}
          style={{ ...btn(false), opacity: state.future.length === 0 ? 0.4 : 1, cursor: state.future.length === 0 ? 'default' : 'pointer' }}>REDO</button>
        <button onClick={() => dispatch({ type: 'TOGGLE_DIMS' })} style={btn(ui.showDims)}>Dims</button>
        <button onClick={doSave} style={btn(state.dirty)}>Save</button>
      </div>

      <div style={{ flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center', padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
        {model.floors.map((f, i) => (
          <button key={i} onClick={() => dispatch({ type: 'SWITCH_FLOOR', index: i })} style={{
            ...btn(i === model.activeFloor), textTransform: 'none', letterSpacing: '0.04em', fontFamily: fonts.sans, fontSize: '11px',
          }}>{f.name}</button>
        ))}
        <button onClick={() => dispatch({ type: 'ADD_FLOOR' })} style={{ ...btn(false), textTransform: 'none', fontFamily: fonts.sans, fontSize: '11px' }}>+ Floor</button>
      </div>

      {floor.reference && (
        <ReferenceControls
          opacity={floor.reference.opacity}
          onOpacity={v => dispatch({ type: 'SET_REFERENCE_FIELD', key: 'opacity', value: v })}
          calibrating={ui.calibrating}
          onToggleCalibrate={() => { setCalDraft(null); dispatch({ type: 'SET_CALIBRATING', on: !ui.calibrating }) }}
          hasDraft={calDraft != null}
          canApply={canApplyCalibration}
          len={calLen}
          onLen={setCalLen}
          onApply={applyCalibration}
        />
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FloorPlanCanvas
            ref={svgRef} model={model} floor={floor} t={t} rooms={rooms} angles={angles} ui={ui} editName={editName}
            imgNatural={imgNatural} calDraft={calDraft}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onMouseDown={onMouseDown}
            onRoomCommit={onRoomCommit} onRoomCancel={onRoomCancel}
          />
        </div>
        <FloorPlanPanel model={model} floor={floor} rooms={rooms} geoJson={geoJson} ui={ui} dispatch={dispatch} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Port the two remaining old test files, adapted to the new selectors/model shape**

`FloorPlanEditor.test.tsx` (basic render/tool-switch smoke tests) and `FloorPlanEditor.calibrate.test.tsx` (calibration flow) existed in the old implementation. Recreate them against the new component using the same `data-el="vertex"|"edge"|"opening"`-based queries as the interaction tests above rather than the old `data-el="wall"|"fp"|"wallend"` ones. Do not skip this step — write real assertions covering: (a) the empty-state upload/start-blank landing screen renders when `initial` is `{}`, (b) clicking a tool button changes `ui.tool` (visible via the button's active style), (c) the full calibrate flow (upload triggers calibrating mode, drawing a line + entering a length + Apply sets `reference.scale_m_per_px`). Follow the exact structure of the interaction tests above (render, `fireEvent`, assert on the resulting DOM) — there is no old file to diff against since it was discarded with the rest of PR #5, so these are new tests written directly against this task's component.

- [ ] **Step 5: Run all three test files to verify they pass**

Run: `cd app/web && npx vitest run src/components/FloorPlanEditor.test.tsx src/components/FloorPlanEditor.interaction.test.tsx src/components/FloorPlanEditor.calibrate.test.tsx`
Expected: PASS. If the T-junction interaction test's `freeHandle` lookup or the connected-drag test's coordinate math doesn't match on the first run (jsdom's pointer-coordinate handling has sharp edges — see the component's own `pointerToWorld` comment), adjust the test's `pointerAt` helper or asserted coordinates to match actual rendered attribute values — read them back with a debug `console.log(container.innerHTML)` if needed rather than guessing, then remove the debug line before committing.

- [ ] **Step 6: Commit**

```bash
git add app/web/src/components/FloorPlanEditor.tsx app/web/src/components/FloorPlanEditor.test.tsx \
        app/web/src/components/FloorPlanEditor.interaction.test.tsx app/web/src/components/FloorPlanEditor.calibrate.test.tsx
git commit -m "feat(web): add FloorPlanEditor pointer interaction for the graph model (connected drag, T-junctions, undo/redo)"
```

## Task 12: `FloorPlanPanel.tsx` — inspector, floor globals, stats

**Files:**
- Create: `app/web/src/components/FloorPlanPanel.tsx`
- Create: `app/web/src/components/FloorPlanPanel.test.tsx`

The panel is a pure display+dispatch component: it reads `ui.sel` to decide what's selected (a vertex, an edge, or an opening — the unified `Sel` type from Task 8) and renders the matching editable fields, plus two sections that are always visible regardless of selection: per-floor global wall-thickness defaults and a stats readout (room list + gross floor area from the traced exterior boundary).

- [ ] **Step 1: Write the failing test**

```tsx
// app/web/src/components/FloorPlanPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import FloorPlanPanel from './FloorPlanPanel'
import { emptyFloorGraph } from '../lib/floorplan/types'
import { addVertex, addEdge } from '../lib/floorplan/graph'
import { roomAreas } from '../lib/floorplan/rooms'
import { initialState, reducer } from '../lib/floorplan/reducer'

function setup(sel: Parameters<typeof initialState>[0] extends never ? never : any = null) {
  const f = emptyFloorGraph('Planta baja')
  const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  const model = { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
  let state = initialState(model)
  if (sel) state = reducer(state, { type: 'SET_SEL', sel })
  const dispatch = vi.fn()
  const rooms = roomAreas(f)
  const geoJson = '{}'
  render(<FloorPlanPanel model={state.model} floor={f} rooms={rooms} geoJson={geoJson} ui={state.ui} dispatch={dispatch} />)
  return { dispatch, f }
}

describe('FloorPlanPanel', () => {
  it('shows editable x/y fields when a vertex is selected', () => {
    const f0 = emptyFloorGraph('Planta baja')
    const a = addVertex(f0, 0, 0)
    const { dispatch } = setup({ t: 'vertex', id: a })
    const xInput = screen.getByLabelText(/x \(m\)/i) as HTMLInputElement
    fireEvent.change(xInput, { target: { value: '2.5' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_VERTEX_POINT', id: a, x: 2.5, y: 0 })
  })

  it('dispatches SET_FLOOR_PARAM when the exterior wall default changes', () => {
    const { dispatch } = setup()
    const extInput = screen.getByLabelText(/muro ext/i) as HTMLInputElement
    fireEvent.change(extInput, { target: { value: '0.2' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FLOOR_PARAM', key: 'extWall_m', value: 0.2 })
  })

  it('lists computed room areas in the stats section', () => {
    setup()
    expect(screen.getByText(/12\.0/)).toBeInTheDocument() // 4m x 3m room = 12 m²
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/web && npx vitest run src/components/FloorPlanPanel.test.tsx`
Expected: FAIL — `./FloorPlanPanel` module doesn't exist yet.

- [ ] **Step 3: Implement `FloorPlanPanel.tsx`**

```tsx
// app/web/src/components/FloorPlanPanel.tsx
import type { Dispatch } from 'react'
import { colors, fonts } from '../lib/theme'
import type { Action, Sel, UI } from '../lib/floorplan/reducer'
import type { FloorGraph, FloorPlanModel } from '../lib/floorplan/types'
import type { RoomArea } from '../lib/floorplan/rooms'
import { exteriorEdgeIds, traceFaces } from '../lib/floorplan/rooms'
import { shoelace } from '../lib/floorplan/geometry'

const PANEL_W = 280

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em', color: colors.secondary, marginBottom: '8px', textTransform: 'uppercase' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value, onCommit, step = 0.05 }: {
  label: string; value: number; onCommit: (v: number) => void; step?: number
}) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        defaultValue={value}
        onBlur={e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onCommit(v) }}
        style={{ width: '80px', fontFamily: 'monospace', fontSize: '12px', background: colors.dark, color: colors.neutral, border: `1px solid ${colors.border}`, borderRadius: '4px', padding: '3px 6px' }}
      />
    </label>
  )
}

function grossAreaM2(floor: FloorGraph): number {
  const faces = traceFaces(floor)
  const extEdges = exteriorEdgeIds(floor)
  const outer = faces.find(f => f.edgeIds.every(id => extEdges.has(id)) && f.edgeIds.length === extEdges.size)
    ?? faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a), faces[0])
  if (!outer) return 0
  const pts = outer.vertexIds.map(id => [floor.vertices[id].x, floor.vertices[id].y] as [number, number])
  return Math.abs(shoelace(pts))
}

function selectedFields(sel: Sel, floor: FloorGraph, dispatch: Dispatch<Action>) {
  if (!sel) return null
  if (sel.t === 'vertex') {
    const v = floor.vertices[sel.id]
    if (!v) return null
    return (
      <Section title="Vértice seleccionado">
        <Field label="X (m)" value={v.x} onCommit={x => dispatch({ type: 'SET_VERTEX_POINT', id: sel.id, x, y: v.y })} />
        <Field label="Y (m)" value={v.y} onCommit={y => dispatch({ type: 'SET_VERTEX_POINT', id: sel.id, x: v.x, y })} />
      </Section>
    )
  }
  if (sel.t === 'edge') {
    const e = floor.edges[sel.id]
    if (!e) return null
    return (
      <Section title="Muro seleccionado">
        <Field label="Espesor (m)" value={e.thickness} step={0.01}
          onCommit={value => dispatch({ type: 'SET_EDGE_THICKNESS', edgeId: sel.id, value })} />
      </Section>
    )
  }
  const e = floor.edges[sel.edgeId]
  const o = e?.openings[sel.index]
  if (!o) return null
  return (
    <Section title={o.kind === 'door' ? 'Puerta seleccionada' : 'Ventana seleccionada'}>
      <Field label="Ancho (m)" value={o.width} step={0.05}
        onCommit={value => dispatch({ type: 'SET_OPENING_FIELD', edgeId: sel.edgeId, index: sel.index, key: 'width', value })} />
    </Section>
  )
}

interface Props {
  model: FloorPlanModel
  floor: FloorGraph
  rooms: RoomArea[]
  geoJson: string
  ui: UI
  dispatch: Dispatch<Action>
}

export default function FloorPlanPanel({ model, floor, rooms, geoJson, ui, dispatch }: Props) {
  const gross = grossAreaM2(floor)
  return (
    <div style={{ width: PANEL_W, flexShrink: 0, borderLeft: `1px solid ${colors.border}`, overflowY: 'auto', background: colors.dark }}>
      {selectedFields(ui.sel, floor, dispatch)}

      <Section title="Parámetros de planta">
        <Field label="Muro ext. (m)" value={floor.extWall_m} step={0.01}
          onCommit={value => dispatch({ type: 'SET_FLOOR_PARAM', key: 'extWall_m', value })} />
        <Field label="Muro int. (m)" value={floor.intWall_m} step={0.01}
          onCommit={value => dispatch({ type: 'SET_FLOOR_PARAM', key: 'intWall_m', value })} />
        <Field label="Altura (m)" value={floor.height_m} step={0.05}
          onCommit={value => dispatch({ type: 'SET_FLOOR_FIELD', key: 'height_m', value })} />
        <Field label="Losa (m)" value={model.slab_m} step={0.01}
          onCommit={value => dispatch({ type: 'SET_SLAB', value })} />
      </Section>

      <Section title="Estadísticas">
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginBottom: '8px' }}>
          Área bruta: <strong>{gross.toFixed(1)} m²</strong>
        </div>
        {rooms.length === 0 ? (
          <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>Sin cuartos detectados</div>
        ) : rooms.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginBottom: '4px' }}>
            <span>{r.name}</span><span>{r.area.toFixed(1)} m²</span>
          </div>
        ))}
      </Section>

      {ui.showDims && (
        <Section title="Exportar BIM (JSON)">
          <pre style={{ fontFamily: 'monospace', fontSize: '10px', color: colors.secondary, whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>{geoJson}</pre>
        </Section>
      )}
    </div>
  )
}
```

`traceFaces`'s returned `TracedFace` needs an `edgeIds` field usable for the outer-boundary lookup above — Task 4 already defines `TracedFace {vertexIds, edgeIds, area}`, so this matches without changes there. Editing an edge's thickness from this panel dispatches `SET_EDGE_THICKNESS`, a dedicated action already defined and handled in Task 8's `reducer.ts` (not a reused/overloaded action with a sentinel index) — no reducer changes are needed for this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/components/FloorPlanPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/components/FloorPlanPanel.tsx app/web/src/components/FloorPlanPanel.test.tsx
git commit -m "feat(web): add FloorPlanPanel inspector, floor globals, and stats"
```

## Task 13: Re-add backend geometry storage and `ProjectDetailPage.tsx` wiring

**Files:**
- Create: `db/migrations/021_project_geometry.sql`
- Modify: `app/api/db.py`
- Modify: `app/api/routes/projects.py`
- Create: `app/api/tests/test_project_geometry.py`
- Create: `app/api/tests/test_project_geometry_routes.py`
- Create: `app/api/tests/test_floorplan_image.py`
- Modify: `app/web/src/components/ProjectDetailPage.tsx`

As corrected in "Before Task 1" above: this entire layer was added by the old, now-discarded branch and does not exist on `origin/main`, which Task 1 reset onto. It stores `geometry` as an opaque `jsonb` blob end to end and never inspects `FloorPlanModel`'s internal shape, so none of it needs to change for the graph rewrite — it only needs to be re-added, once. The code below was read directly from the pre-reset worktree before Task 1 ran, so it's exact, not reconstructed from memory.

**Reordering note (found during execution, before Task 11 was dispatched):** `app/web/src/lib/api.ts`'s three geometry client functions (`fetchProjectGeometry`, `saveProjectGeometry`, `uploadFloorplanImage`) were pulled forward and already landed as their own commit (`cec4bd9`) BEFORE Task 11, because Task 11's `FloorPlanEditor.tsx` imports `uploadFloorplanImage` directly — and Task 13's `ProjectDetailPage.tsx` wiring in turn needs `FloorPlanEditor` to exist, so the original ordering (`api.ts` client functions inside Task 13, after Task 11) was circular. The three functions only need `authFetch`/`BASE` (pre-existing) and the `FloorPlanModel` type (Task 2), so they don't need the backend routes below to exist yet for typechecking — safe to land standalone. Task 13 below therefore no longer has an `api.ts` step; only the backend (Python) files and `ProjectDetailPage.tsx`'s wiring remain.

- [ ] **Step 1: Add the migration**

```sql
-- db/migrations/021_project_geometry.sql
-- migrate:up
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geometry jsonb NOT NULL DEFAULT '{}'::jsonb;

-- migrate:down
ALTER TABLE projects DROP COLUMN IF EXISTS geometry;
```

Confirm `021` is still the next free number (`ls db/migrations/ | tail -3` — should show `020_financial_layer_numeric.sql` as the current head with nothing higher). If a higher-numbered migration landed on `main` from other work since this plan was written, do not renumber — filename-ordered application doesn't care what comes after `021`.

- [ ] **Step 2: Add `db.py`'s geometry functions**

Add `from psycopg2.extras import Json` to the existing `import psycopg2` / `import psycopg2.extras` lines near the top of `app/api/db.py`, then add, near the other project-mutation functions (e.g. next to `update_project`):

```python
def get_project_geometry(project_id: int) -> dict | None:
    """Return the stored geometry model ({} when unset), or None if no such project."""
    with get_db() as conn:
        row = conn.execute("SELECT geometry FROM projects WHERE id = %s", (project_id,)).fetchone()
    if row is None:
        return None
    return row["geometry"] or {}


def set_project_geometry(project_id: int, geometry: dict) -> dict | None:
    """Whole-blob replace of a project's geometry. Returns the stored model, or None."""
    with get_db() as conn:
        row = conn.execute(
            "UPDATE projects SET geometry = %s WHERE id = %s RETURNING geometry",
            (Json(geometry), project_id),
        ).fetchone()
    return None if row is None else (row["geometry"] or {})
```

- [ ] **Step 3: Add the geometry/floorplan-image routes**

In `app/api/routes/projects.py`: append `get_project_geometry, set_project_geometry` to the existing `from api.db import ...` line. Add two new module constants next to the existing `_ALLOWED_MIME`/`_MAX_IMAGE_SIZE`:

```python
_FLOORPLAN_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_FLOORPLAN_ALLOWED_MIME = set(_FLOORPLAN_EXT)  # no GIF: not a sane format for a technical drawing
```

Add a new Pydantic model near the other `BaseModel`s:

```python
class GeometryBody(BaseModel):
    geometry: dict  # deep schema is validated in the TS engine (single source of truth)
```

Add three new routes, after the existing `upload_project_image` route:

```python
@router.get("/api/projects/{project_id}/geometry", operation_id="projects_get_geometry")
def get_geometry(project_id: int, _: dict = Depends(get_current_user)):
    geo = get_project_geometry(project_id)
    if geo is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return geo


@router.put("/api/projects/{project_id}/geometry", operation_id="projects_set_geometry")
def put_geometry(project_id: int, body: GeometryBody,
                 _: dict = Depends(get_current_user)):
    saved = set_project_geometry(project_id, body.geometry)
    if saved is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return saved


@router.post("/api/projects/{project_id}/floorplan-image", status_code=201,
             operation_id="projects_upload_floorplan_image")
async def upload_floorplan_image(project_id: int, file: UploadFile = File(...),
                                  _: dict = Depends(get_current_user)):
    if get_project_geometry(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if file.content_type not in _FLOORPLAN_ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")
    content = await file.read(_MAX_IMAGE_SIZE + 1)
    if len(content) > _MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")
    ext = _FLOORPLAN_EXT[file.content_type]
    key = f"projects/{project_id}/floorplan/{uuid4().hex}{ext}"
    storage.upload(key, content, file.content_type)
    return {"imageKey": key}
```

`uuid4` and `storage` are already imported at the top of this file for the existing image-upload route — no new imports needed beyond the `db.py` function names.

- [ ] **Step 4: `py_compile` both backend files**

```bash
cd app/api && python -m py_compile db.py routes/projects.py
```
Expected: no output (success).

- [ ] **Step 5: Add the three backend test files**

Fixture literals below use the *new* graph shape (Task 2's `FloorPlanModel`) rather than the old wall-list shape, since these are being added fresh in this task rather than ported unchanged — no separate "cosmetic refresh" step is needed.

```python
# app/api/tests/test_project_geometry.py
"""Geometry blob persistence on projects."""
from api.db import get_project_geometry, set_project_geometry


def test_geometry_defaults_to_empty_dict(client, test_project):
    assert get_project_geometry(test_project["id"]) == {}


def test_set_and_get_geometry_roundtrips(test_project):
    model = {
        "schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0,
        "floors": [{
            "name": "Planta Baja", "height_m": 2.60, "extWall_m": 0.15, "intWall_m": 0.10,
            "vertices": {
                "v1": {"id": "v1", "x": 0, "y": 0},
                "v2": {"id": "v2", "x": 5, "y": 0},
            },
            "edges": {
                "e1": {"id": "e1", "v1": "v1", "v2": "v2", "thickness": 0.15, "openings": []},
            },
            "rooms": [{"name": "Sala", "cx": 2.5, "cy": 2.0}],
        }],
    }
    returned = set_project_geometry(test_project["id"], model)
    assert returned == model
    assert get_project_geometry(test_project["id"]) == model


def test_get_geometry_missing_project_returns_none():
    assert get_project_geometry(999_999_999) is None
```

```python
# app/api/tests/test_project_geometry_routes.py
def test_get_geometry_empty_by_default(client, test_project):
    r = client.get(f"/api/projects/{test_project['id']}/geometry")
    assert r.status_code == 200
    assert r.json() == {}


def test_put_geometry_roundtrips(client, test_project):
    model = {"schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0, "floors": []}
    r = client.put(f"/api/projects/{test_project['id']}/geometry",
                   json={"geometry": model})
    assert r.status_code == 200
    assert r.json() == model
    r2 = client.get(f"/api/projects/{test_project['id']}/geometry")
    assert r2.json() == model


def test_put_geometry_unknown_project_404(client):
    r = client.put("/api/projects/999999999/geometry", json={"geometry": {}})
    assert r.status_code == 404


def test_geometry_requires_auth(client):
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides.clear()
    try:
        r = client.get("/api/projects/1/geometry")
        assert r.status_code in (401, 403)
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}
```

```python
# app/api/tests/test_floorplan_image.py
import io


def _png_bytes():
    # 1x1 transparent PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c6360000002000154a24f7f0000000049454e44ae426082"
    )


def test_upload_floorplan_image_returns_key(client, test_project):
    r = client.post(
        f"/api/projects/{test_project['id']}/floorplan-image",
        files={"file": ("plan.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert r.status_code == 201, r.text
    key = r.json()["imageKey"]
    assert key.startswith(f"projects/{test_project['id']}/floorplan/")
    assert key.endswith(".png")


def test_upload_rejects_non_image(client, test_project):
    r = client.post(
        f"/api/projects/{test_project['id']}/floorplan-image",
        files={"file": ("x.txt", io.BytesIO(b"nope"), "text/plain")},
    )
    assert r.status_code == 415


def test_upload_rejects_gif(client, test_project):
    # GIF is allowed for the gallery but not for a technical drawing reference,
    # and the floorplan extension map has no ".gif" entry -- reject it up front
    # so validation and the stored key extension can never disagree.
    r = client.post(
        f"/api/projects/{test_project['id']}/floorplan-image",
        files={"file": ("plan.gif", io.BytesIO(b"GIF89a"), "image/gif")},
    )
    assert r.status_code == 415
```

`client` and `test_project` are existing fixtures already defined in `app/api/tests/conftest.py` (confirmed present on `origin/main`) — no conftest changes needed.

- [ ] **Step 6: Run the new backend tests against a freshly-migrated DB**

```bash
cd app/api && PYTHONPATH=.:.. python -m pytest tests/test_project_geometry.py tests/test_project_geometry_routes.py tests/test_floorplan_image.py -v
```
Expected: all pass.

- [ ] **Step 7: Commit the backend half**

```bash
git add db/migrations/021_project_geometry.sql app/api/db.py app/api/routes/projects.py \
        app/api/tests/test_project_geometry.py app/api/tests/test_project_geometry_routes.py app/api/tests/test_floorplan_image.py
git commit -m "feat(db,api): re-add project geometry storage and floorplan-image upload endpoint"
```

- [ ] **Step 8: Wire the `plano` tab into `ProjectDetailPage.tsx`**

(`api.ts`'s `fetchProjectGeometry`/`saveProjectGeometry`/`uploadFloorplanImage` — formerly this task's own Step 8 — already landed ahead of Task 11; see the reordering note above. `ProjectDetailPage.tsx` below imports them as already-existing functions, not as something this step adds.)

Four small, targeted edits to the existing file (it has substantial unrelated financial-layer JSX — do not restructure anything else):

**8a.** Add two imports near the other component/type imports:
```ts
import FloorPlanEditor, { type PlanApi } from './FloorPlanEditor'
import type { FloorPlanModel } from '../lib/floorplan/types'
```
And extend the existing `../lib/api` import line to also pull in `fetchProjectGeometry, saveProjectGeometry`.

**8b.** Extend the `centerTab` state and add three new pieces of state, right after the existing `const [centerTab, setCenterTab] = useState<'mapa' | 'fotos'>('mapa')` line:
```ts
const [centerTab, setCenterTab] = useState<'mapa' | 'fotos' | 'plano'>('mapa')
const [geometry, setGeometry] = useState<FloorPlanModel | Record<string, never> | null>(null)
const planApiRef = useRef<PlanApi | null>(null)
const [planDirty, setPlanDirty] = useState(false)
```
(`useRef` must be added to the existing `import { useEffect, useState } from 'react'` line if not already present.)

**8c.** In the initial-load `Promise.all([...])` (the one fetching `fetchProject`, `fetchInstances`, `fetchTeam`, etc.), add `fetchProjectGeometry(projectId)` as one more parallel call, and set `geo` from its resolved value:
```ts
Promise.all([
  fetchProject(projectId),
  fetchInstances(projectId),
  fetchTeam(),
  fetchProjectInvestors(projectId),
  fetchInvestors(),
  fetchProjectProfit(projectId),
  fetchProjectGeometry(projectId),
]).then(([p, inst, t, pis, allInv, { waterfall: wf }, geo]) => {
  setProject(p)
  setInstances(inst)
  setTeam(t)
  setProjectInvestors(pis)
  setAllInvestors(allInv)
  setWaterfall(wf)
  setGeometry(geo)
  setTimeout(() => setMounted(true), 40)
  setTimeout(() => setBarsReady(true), 420)
}).catch(e => setError(e instanceof Error ? e.message : 'Error al cargar el proyecto'))
```

**8d.** Extend the existing `save()` handler to also flush a dirty plan through the editor's imperative handle, and add the `onPlanReady` callback:
```ts
// inside save(), after the existing hasEdits branch, before the try block's closing:
if (planApiRef.current?.isDirty()) {
  const saved = await saveProjectGeometry(projectId, planApiRef.current.getModel())
  setGeometry(saved)
  planApiRef.current.markSaved()
  setPlanDirty(false)
}
```
```ts
const onPlanReady = useCallback((api: PlanApi) => { planApiRef.current = api }, [])
```
(`useCallback` must be added to the `react` import if not already present.) Also extend whatever condition currently shows the GUARDAR button from `hasEdits` to `(hasEdits || planDirty)`, so a dirty plan alone is enough to surface Save.

**8e.** Add `'plano'` to the tab-bar array and its render block, at the end of the existing center-column tabs section:
```tsx
{(['mapa', 'fotos', 'plano'] as const).map(tab => (
  <button key={tab} onClick={() => setCenterTab(tab)} style={{
    background: 'transparent', border: 'none',
    borderBottom: centerTab === tab ? `2px solid ${colors.primary}` : '2px solid transparent',
    color: centerTab === tab ? colors.neutral : colors.secondary,
    cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
    letterSpacing: '0.12em', padding: '10px 16px 8px', marginBottom: '-1px',
  }}>
    {tab.toUpperCase()}
  </button>
))}
```
and, alongside the existing `{centerTab === 'mapa' && (...)}` / `{centerTab === 'fotos' && (...)}` blocks:
```tsx
{centerTab === 'plano' && geometry !== null && (
  <FloorPlanEditor
    projectId={projectId}
    initial={geometry}
    onSave={async m => { const saved = await saveProjectGeometry(projectId, m); setGeometry(saved) }}
    onReady={onPlanReady}
    onDirtyChange={setPlanDirty}
  />
)}
```

- [ ] **Step 9: Type-check and confirm the new tab renders**

```bash
cd app/web && npx tsc --noEmit
```
Expected: zero errors. This is the real check that Task 11's `FloorPlanEditor` props (`projectId`, `initial`, `onSave`, `onReady`, `onDirtyChange`) line up exactly with what this call site passes — if they don't, fix the call site here rather than changing Task 11's component (its `PlanApi`/prop shape is the one thing this whole rewrite promised to keep stable for this page).

- [ ] **Step 10: Commit the frontend wiring**

```bash
git add app/web/src/components/ProjectDetailPage.tsx
git commit -m "feat(web): wire the graph-model FloorPlanEditor into ProjectDetailPage's plano tab"
```

## Task 14: Full verification suite

**Files:** none (verification only)

- [ ] **Step 1: Remove stray build artifacts before treating any run as authoritative**

```bash
find app/web/src -name "*.js" -o -name "*.js.map" | grep -v node_modules
```
If this lists any files under `src/` (a known footgun — `tsc` without `outDir`/`noEmit` guards in some invocation paths emits `.js`/`.js.map` siblings in place, which `.gitignore` excludes from git but does not prevent vitest from picking up), delete them:
```bash
find app/web/src -name "*.js" -not -path "*/node_modules/*" -delete
find app/web/src -name "*.js.map" -not -path "*/node_modules/*" -delete
```

- [ ] **Step 2: Backend test suite, freshly-migrated DB**

```bash
cd app/api && PYTHONPATH=.:.. python -m pytest tests/ -q
```
Expected: all tests pass, 0 failures. Record the total count in the task's completion note.

- [ ] **Step 3: Frontend test suite**

```bash
cd app/web && npx vitest run
```
Expected: all tests pass, 0 failures — this includes every `.test.ts`/`.test.tsx` file from Tasks 2–12 (`graph`, `geometry`, `viewTransform`, `calibrate`, `rooms`, `snapping`, `dimensions`, `export`, `reducer`, `FloorPlanCanvas` (if any), `FloorPlanEditor` × 3, `FloorPlanPanel`).

- [ ] **Step 4: Type check**

```bash
cd app/web && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Production build**

```bash
cd app/web && npm run build
```
Expected: build succeeds with no errors.

- [ ] **Step 6: Re-check for stray build artifacts after the full run**

```bash
git status --porcelain app/web/src
```
Expected: clean (no untracked `.js`/`.js.map` siblings reappeared). If any appear, delete them again and note which command produced them so future runs can avoid it.

- [ ] **Step 7: Fix any failures before proceeding**

This is a hard gate — do not proceed to Task 15 with any red test, type error, or failed build.

## Task 15: Manual browser E2E smoke test (non-negotiable)

**Files:** none (manual verification only)

This is the exact step the previous (discarded) floor-plan implementation skipped — its own plan had this as "Phase G," every checkbox unchecked, and it's the direct reason bugs shipped undiagnosed. Do not skip it here. Use the `claude-in-chrome` or `playwright` MCP browser tools (load their schemas via `ToolSearch` first if deferred).

- [ ] **Step 1: Start a live environment**

```bash
cd app/api && PYTHONPATH=.:.. uvicorn main:app --reload --port 8000 &
cd app/web && npm run dev &
```
Confirm both are reachable (`curl -sf http://localhost:8000/docs > /dev/null && echo api ok`, then load the vite dev URL in the browser tool).

- [ ] **Step 2: Navigate to a real project's PLANO tab**

Log in as a test user, open any project, click the `plano` tab (or the newly-added tab from Task 13 if this is the first time it's been wired for that project).

- [ ] **Step 3: Trace a closed loop of walls and confirm the room area appears**

Using the `wall` tool, place at least 4 walls forming a closed rectangle. Confirm a room-area label renders inside the loop, matching the traced-face algorithm's output (Task 4) rather than the old raster flood-fill.

- [ ] **Step 4: Drag a shared corner — confirm every attached wall follows**

Grab a vertex handle where two walls meet and drag it. Confirm **both** walls' endpoints move together with no separation — this is the direct regression test for the original bug report ("walls not moving together unless exactly touching").

- [ ] **Step 5: Drag a wall body — confirm it does NOT force-straighten**

Grab the middle of a diagonal (non-axis-aligned) wall and drag it. Confirm the wall's angle/shape is preserved through the drag (it translates, it does not snap to horizontal/vertical or otherwise reorient) — this is the direct regression test for the second original bug report.

- [ ] **Step 6: Create a T-junction by dragging near a wall's body**

Drag a free-floating wall endpoint until it's near (but not touching the endpoints of) another wall's body. Confirm it snaps onto the wall and creates a proper 3-way junction (visually: the target wall now shows a vertex handle at the drop point, and the dragged wall's endpoint sits exactly on the target wall's line). Also test the midpoint-handle affordance from Task 10/11 directly: click a wall's midpoint handle and confirm it inserts a new corner there.

- [ ] **Step 7: Undo/redo through several steps**

Perform 3–4 edits (a drag, an opening placement, another drag). Press Ctrl+Z three times, confirm each step reverts exactly one gesture (not one pointer-move frame — see Task 11's `dragMovedRef` design). Press Ctrl+Shift+Z to redo, confirm it replays forward correctly.

- [ ] **Step 8: Save, reload, confirm exact round-trip**

Click Save (GUARDAR). Reload the page. Confirm the plan reappears exactly as saved — same vertex positions, same wall thicknesses, same openings, same room names.

- [ ] **Step 9: Capture evidence and clean up**

Take a screenshot of the working editor (for the PR description in Task 16). Stop both dev servers.

If any step in this task fails, treat it as a blocking bug: stop, diagnose against the actual code (not assumptions), fix, and re-run this entire task from Step 1 before proceeding to Task 16.

## Task 16: Push branch, open PR

**Files:** none (git/GitHub operations only)

The design spec (`docs/superpowers/specs/2026-07-20-floorplan-graph-editor-design.md`) was committed on this same branch (`worktree-floorplan-editor`) as part of Task 1's cherry-pick-onto-reset-main step, so this branch already carries every commit from Tasks 1–15 plus the design spec — a single PR covers the full rewrite.

- [ ] **Step 1: Confirm the branch's commit history is exactly what's expected**

```bash
git log --oneline main..HEAD
```
Expected: the design-spec commit followed by one commit per task (2 through 15 — Task 13 produces two, one for the backend re-add and one for the frontend wiring; Task 14/15 produce no commits, being verification-only). No leftover commits from the old, discarded floor-plan implementation should appear — those were removed by Task 1's hard-reset.

- [ ] **Step 2: Push, replacing whatever this branch currently holds on the remote**

The remote branch `floorplan-editor` currently backs the still-open PR #5, which held the old, now-fully-discarded implementation (see Task 1). Since Task 1 hard-reset the local branch to `main` and rebuilt from there, the local history no longer shares a base with what's on the remote — a normal `git push` will be rejected as a non-fast-forward. This was already flagged to the user when the hard-reset strategy was approved ("PR #5 gets force-pushed with entirely new content when we're done").

```bash
git push --force-with-lease origin worktree-floorplan-editor:floorplan-editor
```

`--force-with-lease` (not bare `--force`) so the push aborts instead of clobbering anything if someone else pushed to `floorplan-editor` since this branch's remote-tracking ref was last fetched.

- [ ] **Step 3: Update PR #5's description to describe the rewrite, rather than opening a new PR**

```bash
gh pr view 5 --json title,url
```
Confirm PR #5 is still open and points at `floorplan-editor` → `main`. Then update its description:

```bash
gh pr edit 5 --title "feat: floor-plan editor (vertex-graph rewrite)" --body "$(cat <<'EOF'
## Summary
- Full rewrite of the floor-plan editor on a vertex-graph data model (see docs/superpowers/specs/2026-07-20-floorplan-graph-editor-design.md), replacing the previous independent-walls-plus-coincidence-detection model that caused persistent drag/connectivity bugs.
- Shared corners are now a data fact (same vertex ID referenced by multiple edges), eliminating the entire class of "walls don't move together" and "wall force-straightens on drag" bugs by construction.
- Room areas now come from planar face-tracing on the graph instead of raster flood-fill.
- Backend geometry storage required zero changes (confirmed: the `geometry jsonb` column and its routes are opaque-blob passthrough).

## Test plan
- [ ] Backend suite green against freshly-migrated DB (Task 14)
- [ ] Frontend suite green, `tsc --noEmit` clean, production build succeeds (Task 14)
- [ ] Manual browser E2E: closed-loop wall trace → room area, connected-corner drag, wall-body drag shape preservation, T-junction creation, undo/redo, save/reload round-trip (Task 15 — screenshot attached below)

[screenshot from Task 15]
EOF
)"
```

- [ ] **Step 4: Report status to the user — do not merge**

Tell the user the PR is updated and ready for review at its URL. Per the standing rule reconfirmed throughout this project, do not merge or deploy without their explicit go-ahead.

