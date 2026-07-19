import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { fetchProspects } from '../lib/api'
import { computeScores, DEFAULT_WEIGHTS } from '../lib/scoring'
import type { Prospect } from '../lib/types'
import { colors, fonts } from '../lib/theme'

function pinColor(score: number): string {
  if (score >= 75) return colors.tertiary   // top quartile — terracotta
  if (score >= 50) return '#D4891A'          // second quartile — amber
  if (score >= 25) return colors.accent2    // third quartile — slate
  return colors.secondary                   // bottom quartile — stone
}

export function ProspectMap() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchProspects()
      .then(data => setProspects(computeScores(data, DEFAULT_WEIGHTS)))
      .finally(() => setLoading(false))
  }, [])

  const withCoords = prospects.filter(p => p.latitude !== 0 && p.longitude !== 0)
  const noCoords = prospects.filter(p => p.latitude === 0 || p.longitude === 0)

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 49px)' }}>
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
                fillColor: pinColor(p.score),
                fillOpacity: 0.9,
              }}
              eventHandlers={{ click: () => navigate(`/prospectos/tabla/${p.id}`) }}
            >
              <Popup>
                <strong>{p.name}</strong><br />
                ROI {p.roi ? `${(p.roi * 100).toFixed(1)}%` : '—'} · Score {p.score}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      {noCoords.length > 0 && (
        <div style={{ padding: '10px 16px', background: colors.surfaceAlt, borderTop: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>
          ⚠️ {noCoords.length} prospecto{noCoords.length > 1 ? 's' : ''} sin coordenadas: {noCoords.map(p => p.name).join(', ')}
        </div>
      )}
    </div>
  )
}
