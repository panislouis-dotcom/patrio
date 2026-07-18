import { colors } from './theme'

// Prospect statuses (used in ProspectTable, ProspectDetailPage)
export const PROSPECT_STATUS_COLOR: Record<string, string> = {
  evaluating: colors.tertiary,
  passed: colors.primary,
  converted: '#654F6F',
}

export const PROSPECT_STATUS_LABEL: Record<string, string> = {
  evaluating: 'EVALUANDO',
  passed: 'APROBADO',
  converted: 'CONVERTIDO',
}

// Project statuses (used in ProjectsTab, ProjectDetailPage)
export const PROJECT_STATUS_COLOR: Record<string, string> = {
  construction: '#D4891A',
  stabilizing: '#654F6F',
  operating: colors.primary,
  exited: colors.secondary,
}

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  construction: 'CONSTRUCCIÓN',
  stabilizing: 'ESTABILIZANDO',
  operating: 'OPERANDO',
  exited: 'VENDIDO',
}

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
