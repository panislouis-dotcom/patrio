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
