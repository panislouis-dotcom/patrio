# Floor-Plan Editor Rewrite: Vertex-Graph Design

## Context

The previous floor-plan editor (built on PR #5 / branch `floorplan-editor`, itself a port+finish of upstream refigan's abandoned `feat/project-floorplan-editor` branch) modeled each wall as an independent `{a, b}` coordinate pair. Connectivity between walls (and between walls and footprint corners) was faked at runtime via floating-point coincidence detection (`ATTACH_EPS = 0.02m`, in `snapping.ts`'s `findAttached`): two points were considered "the same corner" if they happened to be within epsilon of each other, not because they shared an identity.

This produced a persistent family of bugs across multiple rounds of fixes: walls not moving together unless exactly touching, walls force-straightening or reorienting when dragged, and cascading unwanted movement across the plan. The root cause was structural, not a set of individual bugs: coincidence-based connectivity is fundamentally fragile, because "are these the same point" is a runtime floating-point judgment call instead of a fact the data model guarantees.

After multiple fix attempts still failed live user testing, the decision was made to discard the existing implementation entirely and rebuild on a proper graph data model, where shared vertices are first-class objects and "two walls share a corner" is a data fact (same vertex ID), not a coincidence.

**Scope decision:** full feature parity with the old editor — dimension chains, snapping, connected drag, room-area computation, reference-image calibration, undo/redo, multi-floor, door/window openings, BIM JSON export — rebuilt on the correct foundation, not a leaner MVP.

**Data status:** PR #5 was never merged to `main` and never used by a real user to save a real project's floor plan (QA-only verification). This is a clean greenfield schema replacement — no migration of existing floor-plan data is needed.

## Data Model

Per-floor, independent graphs (see "Multi-Floor Model" below):

```ts
type VertexId = string;
type EdgeId = string;

interface Vertex {
  id: VertexId;
  x: number;  // meters, world space
  y: number;
}

interface Opening {
  kind: 'door' | 'window';
  offset: number;   // 0..1, fraction of the edge's length
  width: number;    // meters
}

interface Edge {          // a wall segment
  id: EdgeId;
  v1: VertexId;
  v2: VertexId;
  thickness: number;      // meters
  openings: Opening[];
}

interface FloorGraph {
  vertices: Record<VertexId, Vertex>;
  edges: Record<EdgeId, Edge>;
  referenceImage?: { url: string; scale: number; offsetX: number; offsetY: number };
}

interface FloorPlanModel {
  floors: FloorGraph[];
  activeFloor: number;
}
```

**Why this shape:**
- Edges reference vertex **IDs**, not coordinates. Two edges sharing a vertex ID are connected by construction — there is no coincidence detection left to be wrong.
- There is no separate "exterior wall" / "footprint" type. Every wall — exterior or interior — is an `Edge`. "Exterior" is a derived property (computed at render/export time: edges bounding the outer face), not a distinct data structure. This is what makes T-junctions, room detection, and dragging fall out of one consistent model instead of needing footprint/wall sync logic.
- `openings` are stored as a fractional offset along the edge, so they ride along automatically when either endpoint moves.
- `FloorGraph` is fully self-contained per floor (see Multi-Floor Model).

## Core Operations

### Connected drag (no propagation algorithm needed)

Because edges reference vertex IDs, moving a vertex moves every edge that references it — this is a property of how the data is read, not something a drag handler orchestrates. This is the direct fix for the bug family that motivated the rewrite: the old model had to *discover* which points were "attached" via floating-point proximity and then manually push deltas through the discovered set; the new model has nothing to discover, because sharing is identity.

- **Endpoint drag** (grab one vertex): update that vertex's `x, y`. Connected edges follow automatically; each edge's *other* endpoint stays fixed, so the wall pivots/stretches naturally.
- **Wall-body drag** (grab the middle): translate both of the edge's endpoint vertices by an identical delta. If either endpoint is shared with another wall (a corner), that wall's endpoint moves too, via the same mechanism — no separate propagation code. A diagonal wall stays diagonal because both vertices move by the same delta, which preserves shape by construction. No axis-aligned-vs-diagonal special-casing is needed (this eliminates the specific bug class that triggered the rewrite).

### T-junction auto-split

When a dragged vertex is dropped within snap distance of another edge's **body** (not its endpoints — endpoint proximity is plain vertex-snapping, a separate simpler case):

1. Compute the nearest point on the target edge's segment to the dragged vertex.
2. If within snap threshold and not within endpoint-snap threshold of the target edge's `v1`/`v2`, split: replace the target edge `{v1, v2}` with two edges, `{v1, draggedVertexId}` and `{draggedVertexId, v2}`, reusing the dragged vertex's own ID as the new shared point (no orphaned duplicate vertex).
3. Openings on the original edge are redistributed to whichever half they now fall in, with `offset` rescaled to the new sub-length.

This is triggered automatically by ordinary drag-near-a-wall interaction (no separate "add junction" tool), matching how real CAD/floor-plan tools feel.

### Undo/redo

Same design validated in the previous implementation, applied to the new model:
- `EditorState.past` / `future: FloorPlanModel[]` snapshot stacks, capped at `MAX_HISTORY`.
- One push per completed drag gesture (on pointer-up), not per intermediate drag frame — a dedicated action updates the model during a drag without touching history.
- Floor plans are small (tens of vertices per floor), so whole-model snapshots remain cheap even with `openings` arrays included.

## Room Detection: Planar Face-Tracing

Rooms are computed as closed faces of the planar graph, not via raster flood-fill:

1. At each vertex, sort incident edges by angle (direction to the edge's other endpoint).
2. Trace each face by walking directed edges: on arriving at a vertex via one edge, always continue via the *next* edge in rotational order around that vertex (the standard "leftmost turn" planar-face-tracing rule). This traces exactly the boundary of one face with no face/pointer bookkeeping required.
3. Every directed edge belongs to exactly one traced face. Discard the single unbounded "outside" face; the rest are rooms.
4. Room area = shoelace formula on the traced vertex sequence.

This recomputes from scratch after every edit — cheap at floor-plan scale (tens of vertices), so there is no incremental state to keep in sync. Recomputation runs on every drag frame (not just on drop), so room-area labels update live while a wall is being dragged.

**Behavior note:** a room only appears when its walls form a truly closed cycle. Unlike the old raster/flood-fill approach, there is no resolution-driven gap tolerance — a visible gap in the walls means no room area computes there. This is more precise but is a deliberate, known UX difference from the old behavior.

## Persistence & BIM Export

The `geometry` jsonb column stores `FloorPlanModel` (the graph) directly — no wire-format translation layer between the editor's live model and what's persisted. This requires a new migration (superseding the old `geometry` shape; greenfield, no existing data to migrate — see Context).

The BIM JSON export is a pure projection of the graph: walls come directly from `edges` (with absolute opening positions computed from each opening's fractional offset), and a `rooms` array is attached from the face-tracing computation above (polygon + area per room).

## Multi-Floor Model

Each floor is a fully independent `FloorGraph` — no shared vertices or edges across floors, no floor-tagging. This matches the previous editor's behavior (the prior floor is shown only as a dimmed visual reference underlay, never structurally connected) and avoids cross-floor coupling that nothing in the current feature scope needs. `FloorPlanModel.floors` is simply an array of independent `FloorGraph` instances.

## Carryover Features (unaffected by the graph swap)

- **Snapping**: grid snap and angle snap (0°/45°/90°) are unchanged — they only affect where a dragged point lands. Vertex snap becomes *exact* rather than approximate: snapping onto an existing vertex means reusing that vertex's ID (an intentional merge), not landing near a separate coincident point.
- **Dimension chains**: unchanged — cumulative distances read off vertex positions along a path of edges.
- **Reference-image calibration**: orthogonal to the wall model; `referenceImage` lives on `FloorGraph` as before.
- **Multi-floor ghosting**: trivial under independent-graph-per-floor — render the previous floor's edges as a dimmed underlay behind the active floor.

## Testing Strategy

- **Engine unit tests** (pure functions, no UI): vertex/edge mutation, wall-body/endpoint drag translation, T-junction split (including opening-offset redistribution), face-tracing/room-area on fixture graphs, undo/redo reducer round-trips, BIM-export projection shape.
- **Component/interaction tests**: simulated drag gestures for endpoint drag, wall-body drag, and T-junction creation (drag-near-edge-and-drop), room label rendering after a closing edit.
- **Backend tests**: geometry CRUD routes against the new schema, migration correctness.
- **Manual browser E2E smoke test** (non-negotiable — this step was skipped in the prior implementation and is the direct reason it shipped with undiagnosed bugs): trace walls into a closed loop, confirm a room area appears, drag a shared corner and confirm every attached wall follows, drag a wall body and confirm it does not force-straighten, create a T-junction by dragging near a wall's body, undo/redo through several steps, save, reload, confirm the graph round-trips exactly.

## Out of Scope

- BIM/IFC pipeline wiring beyond the JSON export shape (unchanged non-goal from the original upstream design).
- Cross-floor structural coupling (vertical alignment checks, shared vertices across floors) — explicitly deferred; nothing in current scope needs it.
- Migrating any existing persisted floor-plan data — none exists (see Context).
