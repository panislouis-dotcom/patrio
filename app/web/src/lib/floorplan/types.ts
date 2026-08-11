export type VertexId = string
export type EdgeId = string

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
    name, height_m: 2.60, extWall_m: 0.15, intWall_m: 0.10,
    vertices: {}, edges: {}, rooms: [],
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
    // Ausente (clave sin escribir) se normaliza a null para que el tipo no mienta;
    // un v3 ya bien formado conserva su identidad, sin copia.
    if (planned === undefined) return withVariant(null, 'original', original)
    return raw as FloorPlanModel
  }
  if (m.schemaVersion === 2 && isFloorSet(m)) {
    const { slab_m, activeFloor, floors } = m
    return withVariant(null, 'original', { slab_m, activeFloor, floors })
  }
  return null
}

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

export const floorElev = (fs: FloorSet, i: number): number =>
  fs.floors.slice(0, i).reduce((e, f) => e + f.height_m, 0)
