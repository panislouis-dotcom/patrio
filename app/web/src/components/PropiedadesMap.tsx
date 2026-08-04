import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { fetchProperties } from '../lib/api'
import type { Property } from '../lib/types'
import { PROPERTY_STATUS_COLOR, PROPERTY_STATUS_LABEL, hasScore } from '../lib/status'
import { colors, fonts } from '../lib/theme'
import { fmtPct } from '../lib/fmt'
import { pageFill } from '../lib/styles'

/**
 * El mapa pinta el ciclo de vida, no el score: dónde está el capital y dónde
 * están las apuestas se lee de un vistazo por color. El score, que solo existe
 * antes de comprar, se queda en el popup.
 */
export function PropiedadesMap() {
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchProperties()
      .then(setProperties)
      .finally(() => setLoading(false))
  }, [])

  const withCoords = properties.filter(p => p.latitude !== 0 && p.longitude !== 0)
  const noCoords = properties.filter(p => p.latitude === 0 || p.longitude === 0)

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...pageFill }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          center={[25.6866, -100.3161]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          {withCoords.map(p => (
            <CircleMarker
              key={p.id}
              center={[p.latitude, p.longitude]}
              radius={10}
              pathOptions={{
                color: colors.dark,
                weight: 2,
                fillColor: PROPERTY_STATUS_COLOR[p.status],
                fillOpacity: 0.9,
              }}
              eventHandlers={{ click: () => navigate(`/propiedades/${p.id}`) }}
            >
              <Popup>
                <strong>{p.name}</strong><br />
                {PROPERTY_STATUS_LABEL[p.status]} · ROI {fmtPct(p.realizedRoi ?? p.roi ?? p.projectedRoi)}
                {hasScore(p.status) && p.score != null ? ` · Score ${p.score}` : ''}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      {noCoords.length > 0 && (
        <div style={{ padding: '10px 16px', background: colors.surfaceAlt, borderTop: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>
          ⚠️ {noCoords.length} propiedad{noCoords.length > 1 ? 'es' : ''} sin coordenadas: {noCoords.map(p => p.name).join(', ')}
        </div>
      )}
    </div>
  )
}
