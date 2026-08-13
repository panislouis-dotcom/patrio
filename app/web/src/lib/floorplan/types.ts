export type VertexId = string
export type EdgeId = string
export type FixtureId = string

export interface Vertex { id: VertexId; x: number; y: number }

export interface Opening {
  kind: 'door' | 'window'
  offset: number   // 0..1, fraction of the edge's length at drag-commit time
  width: number    // metres
}

// Una 'ghost' es una división manual de un cuarto abierto (cocina-sala sin puerta): divide
// caras para nombres y áreas — traceFaces es genérico sobre aristas — pero NO es muro en
// nada más: sin espesores bulk, sin aberturas, fuera de exteriorEdgeIds/cotas/exports.
export type EdgeKind = 'wall' | 'ghost'

export interface Edge {
  id: EdgeId
  v1: VertexId
  v2: VertexId
  thickness: number   // metres; bulk-updated from extWall_m/intWall_m — see reducer.ts
  openings: Opening[]
  // Ausente = 'wall': así todo blob persistido y todo fixture previo sigue parseando sin
  // migración. Solo se escribe cuando es 'ghost' — un muro no cambia ni un byte.
  kind?: EdgeKind
}

// Espesor nominal de una fantasma: existe solo para que el trazo y el hit-testing del
// canvas (strokeWidth/hit ∝ thickness) tengan un número chico y clickeable. Nunca lo
// tocan los updates bulk de SET_FLOOR_PARAM — no es un espesor de muro real.
export const GHOST_THICKNESS_M = 0.05

export const isGhost = (e: Edge): boolean => e.kind === 'ghost'

export interface Reference {
  imageKey: string
  scale_m_per_px: number
  origin_px: [number, number]
  opacity: number
}

export interface Room { name: string; cx: number; cy: number }

export type FixtureKind =
  | 'cama_individual' | 'cama_matrimonial' | 'cama_queen' | 'cama_king'
  | 'silla' | 'mesa' | 'escritorio' | 'sillon'
  | 'inodoro' | 'lavabo' | 'regadera' | 'tina'
  | 'lavadora' | 'estufa' | 'refrigerador'

export interface Fixture {
  id: FixtureId
  kind: FixtureKind
  x: number; y: number   // centro, metros (mismo sistema que vértices)
  rot: number            // grados, CCW
  w_m: number; h_m: number  // editables; el catálogo solo da el default
}

// Dimensiones reales por defecto (metros). El catálogo es dato, no lógica: agregar un
// mueble nuevo es agregar una entrada, sin tocar el reducer ni el canvas.
export const FIXTURE_CATALOG: Record<FixtureKind, { label: string; w_m: number; h_m: number }> = {
  cama_individual:  { label: 'Cama individual',  w_m: 1.00, h_m: 1.90 },
  cama_matrimonial: { label: 'Cama matrimonial', w_m: 1.40, h_m: 1.90 },
  cama_queen:       { label: 'Cama queen',       w_m: 1.60, h_m: 2.00 },
  cama_king:        { label: 'Cama king',        w_m: 1.93, h_m: 2.03 },
  silla:            { label: 'Silla',            w_m: 0.45, h_m: 0.45 },
  mesa:             { label: 'Mesa',             w_m: 1.60, h_m: 0.90 },
  escritorio:       { label: 'Escritorio',       w_m: 1.20, h_m: 0.60 },
  sillon:           { label: 'Sillón',           w_m: 2.00, h_m: 0.90 },
  inodoro:          { label: 'Inodoro',          w_m: 0.40, h_m: 0.65 },
  lavabo:           { label: 'Lavabo',           w_m: 0.55, h_m: 0.45 },
  regadera:         { label: 'Regadera',         w_m: 0.90, h_m: 0.90 },
  tina:             { label: 'Tina',             w_m: 0.80, h_m: 1.70 },
  lavadora:         { label: 'Lavadora',         w_m: 0.60, h_m: 0.60 },
  estufa:           { label: 'Estufa',           w_m: 0.76, h_m: 0.66 },
  refrigerador:     { label: 'Refrigerador',     w_m: 0.90, h_m: 0.80 },
}

export interface FloorGraph {
  // Identidad estable del piso, independiente de su posición (sobrevive a reordenar) y de
  // su nombre (sobrevive a renombrar). Requerido — no opcional — para que ningún consumidor
  // tenga que verificar su ausencia: emptyFloorGraph/ADD_FLOOR lo asignan al crear, y
  // migrateGeometry lo rellena en memoria para todo blob viejo que aún no lo tenga.
  id: string
  name: string
  height_m: number
  extWall_m: number
  intWall_m: number
  vertices: Record<VertexId, Vertex>
  edges: Record<EdgeId, Edge>
  rooms: Room[]          // user-assigned names, matched to traced faces by nearest centroid
  reference?: Reference
  // Ausente = []: mismo patrón que Edge.kind — un blob persistido antes de esta feature
  // no tiene esta clave y debe leerse como "sin muebles", nunca como un crash.
  fixtures?: Fixture[]
}

// El editor trabaja sobre UNA variante (un plano completo, multi-piso); el envelope
// persistido guarda dos: el levantamiento ORIGINAL (cómo está la propiedad) y el
// PLANEADO (cómo va a quedar), null hasta que el usuario lo crea. FloorSet es el shape
// v2 sin schemaVersion: la migración v2→v3 es anidarlo como `original`.
export interface FloorSet {
  slab_m: number
  activeFloor: number
  floors: FloorGraph[]
}

export type VariantKey = 'original' | 'planned'

export interface FloorPlanModel {
  schemaVersion: 3
  variants: { original: FloorSet; planned: FloorSet | null }
}

export function genId(): string {
  return crypto.randomUUID()
}

export function emptyFloorGraph(name: string): FloorGraph {
  return {
    id: genId(),
    name, height_m: 2.60, extWall_m: 0.15, intWall_m: 0.10,
    vertices: {}, edges: {}, rooms: [], fixtures: [],
  }
}

export function emptyFloorSet(): FloorSet {
  return { slab_m: 0.15, activeFloor: 0, floors: [emptyFloorGraph('Planta Baja')] }
}

/**
 * El único constructor del envelope v3: escribe UNA variante y preserva la otra tal
 * cual venga en `model` (o su default si no hay modelo: el original nace en blanco,
 * el planeado nace inexistente). Todo literal `{ schemaVersion: 3, variants: … }`
 * vive aquí — quien guarda una variante no puede, ni por accidente, pisar la otra.
 */
export function withVariant(model: FloorPlanModel | null, key: VariantKey, fs: FloorSet): FloorPlanModel {
  return {
    schemaVersion: 3,
    variants: {
      original: key === 'original' ? fs : model?.variants.original ?? emptyFloorSet(),
      planned: key === 'planned' ? fs : model?.variants.planned ?? null,
    },
  }
}

const isFloorSet = (v: unknown): v is FloorSet =>
  !!v && typeof v === 'object' && Array.isArray((v as FloorSet).floors)

// Rellena `id` en memoria a cualquier piso de `fs` que no lo tenga — ya sea un piso v2 recién
// anidado (nunca tuvo el campo) o un piso v3 guardado antes de que este campo existiera
// (isFloorSet solo valida que `floors` sea un arreglo, no que cada piso esté completo). Cada
// piso llama a genId() por su cuenta dentro del loop: un `.map(() => ({...f, id: genId()}))`
// evaluado perezosamente o un `const id = genId()` sacado del loop reusarían el mismo id en
// dos pisos distintos — mutar in-place, uno por uno, evita ambos. Un piso que YA trae id no
// se toca: no pisar un id real en cada carga, solo rellenar los que faltan de verdad.
function backfillFloorIds(fs: FloorSet): void {
  for (const f of fs.floors) {
    if (!f.id) f.id = genId()
  }
}

/**
 * Único punto de entrada para leer un blob de geometría persistido: v3 pasa tal cual,
 * v2 (un plano en la raíz) se anida como variante `original` con `planned: null`.
 * Cualquier otra cosa —schemaVersion 1 del viejo editor de listas de muros, `{}`,
 * basura— regresa null. Es una frontera greenfield deliberada, no una migración de v1:
 * el blob viejo queda intacto en storage (nada escribe hasta que el usuario vuelve a
 * guardar) pero jamás se lee como si fuera un modelo válido.
 */
export function migrateGeometry(raw: unknown): FloorPlanModel | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as { schemaVersion?: unknown; variants?: { original?: unknown; planned?: unknown } }
  if (m.schemaVersion === 3) {
    const original = m.variants?.original
    const planned = m.variants?.planned
    if (!isFloorSet(original)) return null
    // Un planned presente pero malformado invalida el blob ENTERO: si miente en una
    // variante puede mentir en la otra, y leerlo a medias es peor que no leerlo.
    if (planned != null && !isFloorSet(planned)) return null
    // Backfill de `id` ANTES de entregar el modelo: mutar in-place preserva la identidad
    // del objeto para el caso ya-bien-formado (nada que rellenar, mismo objeto de vuelta).
    backfillFloorIds(original)
    if (isFloorSet(planned)) backfillFloorIds(planned)
    // Ausente (clave sin escribir) se normaliza a null para que el tipo no mienta;
    // un v3 ya bien formado conserva su identidad, sin copia.
    if (planned === undefined) return withVariant(null, 'original', original)
    return raw as FloorPlanModel
  }
  if (m.schemaVersion === 2 && isFloorSet(m)) {
    const { slab_m, activeFloor, floors } = m
    backfillFloorIds({ slab_m, activeFloor, floors })
    return withVariant(null, 'original', { slab_m, activeFloor, floors })
  }
  return null
}

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

export const floorElev = (fs: FloorSet, i: number): number =>
  fs.floors.slice(0, i).reduce((e, f) => e + f.height_m, 0)
