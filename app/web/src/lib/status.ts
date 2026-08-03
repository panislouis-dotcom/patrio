import { colors } from './theme'

// El ciclo de vida de una propiedad. El orden del arreglo ES el orden del
// negocio: se avanza hacia adelante, nunca se retrocede. `archivada` queda
// fuera porque no es una etapa sino un cajón — se llega desde cualquier estado
// no terminal y no se sale.
export const LIFECYCLE: readonly PropertyStatus[] = [
  'prospecto',
  'oferta',
  'desarrollo',
  'en_renta',
  'vendida',
] as const

export type PropertyStatus =
  | 'prospecto'
  | 'oferta'
  | 'desarrollo'
  | 'en_renta'
  | 'vendida'
  | 'archivada'

export const PROPERTY_STATUS_LABEL: Record<PropertyStatus, string> = {
  prospecto: 'PROSPECTO',
  oferta: 'OFERTA',
  desarrollo: 'DESARROLLO',
  en_renta: 'EN RENTA',
  vendida: 'VENDIDA',
  archivada: 'ARCHIVADA',
}

export const PROPERTY_STATUS_COLOR: Record<PropertyStatus, string> = {
  prospecto: colors.tertiary,
  oferta: '#D4891A',
  desarrollo: colors.accent1,
  en_renta: colors.primary,
  vendida: colors.secondary,
  archivada: colors.border,
}

// Transiciones permitidas — espejo del trigger de la migración 024. La UI las
// usa para ofrecer solo los destinos reales; el servidor valida de nuevo (y la
// base de datos una tercera vez): tres capas, una sola verdad.
export const ALLOWED_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  prospecto: ['oferta', 'archivada'],
  oferta: ['desarrollo', 'archivada'],
  desarrollo: ['en_renta', 'vendida', 'archivada'],
  en_renta: ['vendida', 'archivada'],
  vendida: [], // terminal: una venta es el track record de la firma, no se archiva
  archivada: [], // terminal
}

// Una propiedad vendida o archivada ya no se mueve.
export const isTerminal = (status: PropertyStatus): boolean =>
  ALLOWED_TRANSITIONS[status].length === 0

// El score solo ordena candidatos que compiten por capital; después de comprar
// no hay a quién ganarle. El backend lo devuelve null fuera de esta ventana.
export const hasScore = (status: PropertyStatus): boolean =>
  status === 'prospecto' || status === 'oferta'

// Process instance statuses (used in ProcesoInstanceList)
export const PROCESS_INSTANCE_STATUS_COLOR: Record<string, string> = {
  active: colors.primary,
  completed: colors.secondary,
  cancelled: colors.border,
}

// Process node/task statuses (used in ProcesoInstanceDetail)
export const PROCESS_STATUS_COLOR: Record<string, string> = {
  pending: colors.secondary,
  in_progress: colors.tertiary,
  done: colors.primary,
  skipped: colors.border,
}

export const PROCESS_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  in_progress: 'En progreso',
  done: 'Completado',
  skipped: 'Omitido',
}
