import type { CSSProperties } from 'react'
import { colors, fonts } from '../lib/theme'

export const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: `1px solid ${colors.border}`,
  fontFamily: fonts.sans,
  fontSize: '12px',
}

export const inlineInputStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${colors.tertiary}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '12px',
  padding: '2px 0',
  width: '140px',
  outline: 'none',
  textAlign: 'right',
}

export interface EditableRowProps {
  fieldKey: string
  label: string
  displayValue: string
  isActive: boolean
  inputType: 'text' | 'number' | 'date'
  inputStep?: string
  inputValue: string
  issueBadge?: string
  onActivate: () => void
  onDeactivate: () => void
  onChange: (raw: string) => void
}

export function EditableRow({
  label,
  displayValue,
  isActive,
  inputType,
  inputStep,
  inputValue,
  issueBadge,
  onActivate,
  onDeactivate,
  onChange,
}: EditableRowProps) {
  return (
    <div style={rowStyle}>
      <span style={{ color: colors.secondary }}>
        {label}{issueBadge ?? ''}
      </span>
      {isActive ? (
        <input
          type={inputType}
          step={inputStep}
          value={inputValue}
          autoFocus
          onChange={e => onChange(e.target.value)}
          onBlur={onDeactivate}
          onKeyDown={e => { if (e.key === 'Escape') onDeactivate() }}
          style={inlineInputStyle}
        />
      ) : (
        <span
          style={{ color: colors.neutral, cursor: 'text' }}
          onClick={onActivate}
        >
          {displayValue}
        </span>
      )}
    </div>
  )
}

export function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={rowStyle}>
      <span style={{ color: colors.secondary }}>{label}</span>
      <span style={{ color: colors.neutral }}>{value}</span>
    </div>
  )
}
