import { useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'

interface Props {
  lat: number
  lon: number
  onChange: (lat: number, lon: number) => void
}

const _MONTERREY: [number, number] = [25.6866, -100.3161]

function MapClickHandler({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onPlace(e.latlng.lat, e.latlng.lng) })
  return null
}

export function LatLonPicker({ lat, lon, onChange }: Props) {
  const [open, setOpen] = useState(false)

  const hasCoords = lat !== 0 || lon !== 0
  const center: [number, number] = hasCoords ? [lat, lon] : _MONTERREY

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
        <div>
          <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>
            LATITUD
          </div>
          <input
            type="number"
            step="any"
            value={lat !== 0 ? lat : ''}
            placeholder="0"
            onChange={e => {
              const val = parseFloat(e.target.value)
              if (isFinite(val)) onChange(val, lon)
            }}
            style={fieldInput}
          />
        </div>
        <div>
          <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>
            LONGITUD
          </div>
          <input
            type="number"
            step="any"
            value={lon !== 0 ? lon : ''}
            placeholder="0"
            onChange={e => {
              const val = parseFloat(e.target.value)
              if (isFinite(val)) onChange(lat, val)
            }}
            style={fieldInput}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent',
          border: `1px solid ${colors.border}`,
          color: colors.secondary,
          fontFamily: fonts.label,
          fontSize: '8px',
          letterSpacing: '0.08em',
          padding: '4px 10px',
          cursor: 'pointer',
          marginBottom: open ? '8px' : '0',
        }}
      >
        📍 {open ? 'CERRAR MAPA' : 'ABRIR MAPA'}
      </button>

      {open && (
        <div style={{ height: '200px', borderRadius: '2px', overflow: 'hidden' }}>
          <MapContainer
            center={center}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="© OpenStreetMap"
            />
            <MapClickHandler onPlace={onChange} />
            {hasCoords && (
              <CircleMarker
                center={[lat, lon]}
                radius={10}
                pathOptions={{ color: colors.primary, fillColor: colors.primary, fillOpacity: 0.7 }}
              />
            )}
          </MapContainer>
        </div>
      )}
    </div>
  )
}
