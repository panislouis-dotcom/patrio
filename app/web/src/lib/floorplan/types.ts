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

// Catálogo explícito, elegido en un dropdown al colocar/renombrar un cuarto — mismo
// espíritu que FIXTURE_CATALOG ("el catálogo es dato, no lógica"). Reemplaza la
// inferencia frágil por palabra clave sobre el nombre libre (planFacts.ts) como fuente
// PRIMARIA de tipo: un nombre como "CUARTO 3" nunca iba a matchear nada, y "escalera"/
// "recibidor" ni siquiera estaban en ese catálogo (ver diagnóstico de Locales Salón
// Escobedo). 'otro' es una decisión positiva ("miré la lista, ninguna aplica"), no un
// valor ausente — planFacts.ts lo trata distinto de "sin tipo capturado todavía".
export type RoomType =
  | 'recamara' | 'bano' | 'cocina' | 'sala' | 'comedor'
  | 'vestibulo' | 'escalera' | 'pasillo' | 'closet'
  | 'lavanderia' | 'cuarto_servicio' | 'cochera'
  | 'patio' | 'terraza' | 'jardin' | 'azotea'
  | 'otro'

// `color` alimenta el relleno plano por tipo de cuarto en la imagen de referencia del
// render (planImage.ts) — canal VISUAL de identidad de cuarto, alternativa a que el
// modelo tenga que leerlo solo en prosa (planFacts.ts). Calculado con Python (HSL, 16
// tonos — todos los RoomType salvo 'otro' — a 360°/16 = 22.5° de separación, S=0.55,
// L=0.82), no elegido a ojo (regla del repo: los números se calculan, no se adivinan).
// Verificado contra los umbrales reales de app/api/renders.py: luminancia mínima 191.5
// (margen de 131.5 sobre WALL_LUMINANCE_MAX=60 — ningún relleno se confunde jamás con
// un muro en _composite_geometry) y máxima 226.5 (margen de 18.5 bajo
// _BBOX_BG_THRESHOLD=245). 'otro' es el único tipo sin color: es una decisión positiva
// del usuario ("ninguna categoría aplica"), no una señal real que pintar.
export const ROOM_TYPE_CATALOG: Record<RoomType, { label: string; color?: string }> = {
  recamara: { label: 'Recámara', color: '#EAB8B8' },
  bano: { label: 'Baño', color: '#EACBB8' },
  cocina: { label: 'Cocina', color: '#EADEB8' },
  sala: { label: 'Sala', color: '#E4EAB8' },
  comedor: { label: 'Comedor', color: '#D1EAB8' },
  vestibulo: { label: 'Vestíbulo', color: '#BEEAB8' },
  escalera: { label: 'Escalera', color: '#B8EAC4' },
  pasillo: { label: 'Pasillo', color: '#B8EAD7' },
  closet: { label: 'Clóset', color: '#B8EAEA' },
  lavanderia: { label: 'Lavandería', color: '#B8D7EA' },
  cuarto_servicio: { label: 'Cuarto de servicio', color: '#B8C4EA' },
  cochera: { label: 'Cochera', color: '#BEB8EA' },
  patio: { label: 'Patio', color: '#D1B8EA' },
  terraza: { label: 'Terraza', color: '#E4B8EA' },
  jardin: { label: 'Jardín', color: '#EAB8DE' },
  azotea: { label: 'Azotea', color: '#EAB8CB' },
  otro: { label: 'Otro' },
}

// type ausente = sin capturar: mismo patrón que Edge.kind — un blob persistido antes de
// esta feature no tiene la clave, y clone()/JSON.stringify ya dropean valores undefined
// solos, así que "sin tipo" nunca escribe basura al guardar.
export interface Room { name: string; cx: number; cy: number; type?: RoomType }

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

// Familia visual mínima por tipo — antes vivía privada en FloorPlanCanvas.tsx ("es de
// dibujo, no de dimensiones"), pero planImage.ts (la imagen de referencia que ve el
// modelo de render) ahora también necesita la MISMA agrupación para el relleno de color
// por familia — dos consumidores de la misma taxonomía, así que se mueve aquí en vez de
// duplicarse (el mismo criterio ya aplicado a ROOM_TYPE_CATALOG).
export type FixtureFamily =
  | 'bed' | 'seat' | 'plain' | 'toilet' | 'sink' | 'shower' | 'tub' | 'laundry' | 'stove' | 'fridge'

// Nombre en español de cada familia — usado por la leyenda de color de planFacts.ts
// (fixtureFamilyFill), mismo papel que ROOM_TYPE_CATALOG[t].label ya cumple para la
// leyenda de color de tipo de cuarto.
export const FIXTURE_FAMILY_LABEL: Record<FixtureFamily, string> = {
  bed: 'cama', seat: 'asiento', plain: 'mesa o escritorio', toilet: 'inodoro',
  sink: 'lavabo', shower: 'regadera', tub: 'tina', laundry: 'lavadora',
  stove: 'estufa', fridge: 'refrigerador',
}

// Dimensiones reales por defecto (metros), familia visual y color de relleno por familia.
// El catálogo es dato, no lógica: agregar un mueble nuevo es agregar una entrada, sin tocar
// el reducer ni el canvas. `color`: paleta HSL (Python, S=0.55, L=0.65, 10 tonos a 36° de
// separación — misma rigurosidad que ROOM_TYPE_CATALOG.color, S=0.55/L=0.82 ahí) deliberada-
// mente más oscura/saturada que la de tipo de cuarto: un mueble es un objeto PEQUEÑO encima
// de un relleno de cuarto, no otra zona de área, y tiene que leerse como categoría visual
// distinta. Verificada contra los umbrales reales de app/api/renders.py: luminancia mínima
// 133.9 (margen de 73.9 sobre WALL_LUMINANCE_MAX=60 — igual que el trazo actual `#555555`
// ≈85, deliberadamente por encima de ese umbral, ningún relleno de mueble se compone jamás
// como muro) y máxima 197.8 (margen de 47.2 bajo `_BBOX_BG_THRESHOLD=245`).
export const FIXTURE_CATALOG: Record<FixtureKind, { label: string; w_m: number; h_m: number; family: FixtureFamily; color: string }> = {
  cama_individual:  { label: 'Cama individual',  w_m: 1.00, h_m: 1.90, family: 'bed',     color: '#D77575' },
  cama_matrimonial: { label: 'Cama matrimonial', w_m: 1.40, h_m: 1.90, family: 'bed',     color: '#D77575' },
  cama_queen:       { label: 'Cama queen',       w_m: 1.60, h_m: 2.00, family: 'bed',     color: '#D77575' },
  cama_king:        { label: 'Cama king',        w_m: 1.93, h_m: 2.03, family: 'bed',     color: '#D77575' },
  silla:            { label: 'Silla',            w_m: 0.45, h_m: 0.45, family: 'seat',    color: '#D7B075' },
  sillon:           { label: 'Sillón',           w_m: 2.00, h_m: 0.90, family: 'seat',    color: '#D7B075' },
  mesa:             { label: 'Mesa',             w_m: 1.60, h_m: 0.90, family: 'plain',   color: '#C3D775' },
  escritorio:       { label: 'Escritorio',       w_m: 1.20, h_m: 0.60, family: 'plain',   color: '#C3D775' },
  inodoro:          { label: 'Inodoro',          w_m: 0.40, h_m: 0.65, family: 'toilet',  color: '#88D775' },
  lavabo:           { label: 'Lavabo',           w_m: 0.55, h_m: 0.45, family: 'sink',    color: '#75D79C' },
  regadera:         { label: 'Regadera',         w_m: 0.90, h_m: 0.90, family: 'shower',  color: '#75D7D7' },
  tina:             { label: 'Tina',             w_m: 0.80, h_m: 1.70, family: 'tub',     color: '#759CD7' },
  lavadora:         { label: 'Lavadora',         w_m: 0.60, h_m: 0.60, family: 'laundry', color: '#8875D7' },
  estufa:           { label: 'Estufa',           w_m: 0.76, h_m: 0.66, family: 'stove',   color: '#C375D7' },
  refrigerador:     { label: 'Refrigerador',     w_m: 0.90, h_m: 0.80, family: 'fridge',  color: '#D775B0' },
}

// Una cota MANUAL: el usuario la coloca donde quiere ver una medida, con dos puntos
// libres (no atada a un muro real) — a diferencia de las cadenas de cota automáticas
// (dimensions.ts), que se calculan solas y a veces abarrotan la pantalla. La distancia
// NUNCA se guarda — se deriva de p1/p2 en cada lugar que la necesita, mismo principio que
// el área de un cuarto (roomAreas), que tampoco se persiste.
export type ManualDimensionId = string
export interface ManualDimension {
  id: ManualDimensionId
  p1: { x: number; y: number }
  p2: { x: number; y: number }
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
  // Ausente = []: mismo patrón que `fixtures` — un blob persistido antes de esta feature
  // no tiene esta clave y debe leerse como "sin cotas manuales", nunca como un crash.
  manualDimensions?: ManualDimension[]
}

// El editor trabaja sobre UNA variante (un plano completo, multi-piso); el envelope
// persistido guarda el levantamiento ORIGINAL (cómo está la propiedad) y N PLANES de
// proyecto (propuestas de cómo podría quedar), lista vacía hasta que el usuario crea el
// primero. FloorSet es el shape v2 sin schemaVersion: la migración v2 es anidarlo como
// `original`.
export interface FloorSet {
  slab_m: number
  activeFloor: number
  floors: FloorGraph[]
}

/** Un plan de proyecto nombrado. `id` es identidad persistida (uuid al crear —
 * NUNCA minteado al leer: un id efímero de lectura ya causó el bug que la
 * migración 048 reparó en producción para los pisos); `name` es la etiqueta que
 * el usuario edita y el prospecto imprime. */
export interface ProjectPlan { id: string; name: string; fs: FloorSet }

/** Qué variante direcciona una operación: el original, o un plan por su id.
 * Generaliza al viejo VariantKey ('original' | 'planned'): el plan migrado desde
 * v3 conserva el id literal 'planned' (ver LEGACY_PLAN_ID), así que todo código y
 * todo dato que decía 'planned' sigue direccionando el mismo plan sin traducción. */
export type PlanKey = 'original' | string

/** @deprecated Alias de transición — se elimina cuando el selector de planes (UI)
 * reemplace los dos montajes fijos original/planned. */
export type VariantKey = PlanKey

/** Id determinista del plan migrado desde el `planned` de v3. Literal a propósito:
 * `property_renders.source_variant='planned'` (todas las filas existentes) empata
 * con este plan SIN backfill, y un blob migrado en memoria (TS) y uno migrado en
 * SQL (migración 050) producen el MISMO id — sin carrera de ids efímeros. */
export const LEGACY_PLAN_ID = 'planned'
export const LEGACY_PLAN_NAME = 'Plan de proyecto'

export interface FloorPlanModel {
  schemaVersion: 4
  variants: { original: FloorSet; plans: ProjectPlan[] }
}

export function genId(): string {
  return crypto.randomUUID()
}

export function emptyFloorGraph(name: string): FloorGraph {
  return {
    id: genId(),
    name, height_m: 2.60, extWall_m: 0.15, intWall_m: 0.10,
    vertices: {}, edges: {}, rooms: [], fixtures: [], manualDimensions: [],
  }
}

export function emptyFloorSet(): FloorSet {
  return { slab_m: 0.15, activeFloor: 0, floors: [emptyFloorGraph('Planta Baja')] }
}

/**
 * Los únicos constructores del envelope v4: escriben UNA variante (el original, o
 * un plan por id) y preservan todo lo demás tal cual venga en `model` (o su default
 * si no hay modelo: el original nace en blanco, los planes nacen como lista vacía).
 * Todo literal `{ schemaVersion: 4, variants: … }` vive aquí — quien guarda una
 * variante no puede, ni por accidente, pisar las otras. Mismo contrato que el viejo
 * `withVariant`, generalizado a N planes.
 */
export function withOriginal(model: FloorPlanModel | null, fs: FloorSet): FloorPlanModel {
  return {
    schemaVersion: 4,
    variants: { original: fs, plans: model?.variants.plans ?? [] },
  }
}

/** Upsert por id: reemplaza el plan si existe, lo agrega al final si no. El objeto
 * `plan` entra completo (id + name + fs) — quien guarda solo la geometría de un plan
 * existente es responsable de conservar su `name` (leerlo del modelo antes). */
export function withPlan(model: FloorPlanModel | null, plan: ProjectPlan): FloorPlanModel {
  const plans = model?.variants.plans ?? []
  const i = plans.findIndex(p => p.id === plan.id)
  return {
    schemaVersion: 4,
    variants: {
      original: model?.variants.original ?? emptyFloorSet(),
      plans: i >= 0 ? plans.map(p => (p.id === plan.id ? plan : p)) : [...plans, plan],
    },
  }
}

export function removePlan(model: FloorPlanModel, planId: string): FloorPlanModel {
  return {
    schemaVersion: 4,
    variants: {
      original: model.variants.original,
      plans: model.variants.plans.filter(p => p.id !== planId),
    },
  }
}

export function getPlan(model: FloorPlanModel | null, planId: string): ProjectPlan | null {
  return model?.variants.plans.find(p => p.id === planId) ?? null
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

const isProjectPlan = (v: unknown): v is ProjectPlan =>
  !!v && typeof v === 'object'
  && typeof (v as ProjectPlan).id === 'string' && (v as ProjectPlan).id !== ''
  && typeof (v as ProjectPlan).name === 'string'
  && isFloorSet((v as ProjectPlan).fs)

/**
 * Único punto de entrada para leer un blob de geometría persistido: v4 pasa tal cual,
 * v3 (dos variantes fijas original/planned) se convierte — el planned, si existe, se
 * vuelve el primer plan con el id determinista LEGACY_PLAN_ID —, y v2 (un plano en la
 * raíz) se anida como `original` con `plans: []`. Cualquier otra cosa —schemaVersion 1
 * del viejo editor de listas de muros, `{}`, basura— regresa null. Es una frontera
 * greenfield deliberada, no una migración de v1: el blob viejo queda intacto en storage
 * (nada escribe hasta que el usuario vuelve a guardar) pero jamás se lee como si fuera
 * un modelo válido.
 *
 * Un plan presente pero malformado (en v4: cualquier entrada de `plans`; en v3: el
 * `planned`) invalida el blob ENTERO: si miente en una variante puede mentir en las
 * otras, y leerlo a medias es peor que no leerlo — mismo criterio de siempre.
 *
 * Efecto de lado: rellena `FloorGraph.id` en cualquier piso que no lo tenga, MUTANDO
 * `raw` in-place vía `backfillFloorIds` (ver su comentario) antes de devolver el modelo —
 * ese id backfilleado es efímero hasta el próximo guardado, no una escritura a storage.
 */
export function migrateGeometry(raw: unknown): FloorPlanModel | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as {
    schemaVersion?: unknown
    variants?: { original?: unknown; planned?: unknown; plans?: unknown }
  }
  if (m.schemaVersion === 4) {
    const original = m.variants?.original
    const plans = m.variants?.plans
    if (!isFloorSet(original)) return null
    if (!Array.isArray(plans) || !plans.every(isProjectPlan)) return null
    backfillFloorIds(original)
    for (const p of plans) backfillFloorIds(p.fs)
    // Un v4 bien formado conserva su identidad, sin copia.
    return raw as FloorPlanModel
  }
  if (m.schemaVersion === 3) {
    const original = m.variants?.original
    const planned = m.variants?.planned
    if (!isFloorSet(original)) return null
    if (planned != null && !isFloorSet(planned)) return null
    backfillFloorIds(original)
    if (isFloorSet(planned)) backfillFloorIds(planned)
    // El id/nombre del plan legado son literales deterministas (ver LEGACY_PLAN_ID):
    // los renders persistidos con source_variant='planned' lo direccionan sin backfill,
    // y la migración SQL 050 produce byte-lógicamente lo mismo que esta rama.
    const model = withOriginal(null, original)
    return isFloorSet(planned)
      ? withPlan(model, { id: LEGACY_PLAN_ID, name: LEGACY_PLAN_NAME, fs: planned })
      : model
  }
  if (m.schemaVersion === 2 && isFloorSet(m)) {
    const { slab_m, activeFloor, floors } = m
    backfillFloorIds({ slab_m, activeFloor, floors })
    return withOriginal(null, { slab_m, activeFloor, floors })
  }
  return null
}

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

export const floorElev = (fs: FloorSet, i: number): number =>
  fs.floors.slice(0, i).reduce((e, f) => e + f.height_m, 0)
