import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import { colors, fonts } from '../../lib/theme'

interface Props {
  lat: number | null
  lon: number | null
  markerColor: string
}

export function MapPanel({ lat, lon, markerColor }: Props) {
  // Both pages read a 0 coordinate as "never geocoded", so a single 0 hides the
  // map rather than pointing at the equator or the prime meridian.
  const hasCoords = lat != null && lon != null && lat !== 0 && lon !== 0

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      {hasCoords ? (
        <MapContainer
          center={[lat, lon]}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          <CircleMarker
            center={[lat, lon]}
            radius={12}
            pathOptions={{ color: markerColor, fillColor: markerColor, fillOpacity: 0.7, weight: 2 }}
          />
        </MapContainer>
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.border }}>SIN COORDENADAS</div>
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Agrega lat/lng en el panel izquierdo</div>
        </div>
      )}
    </div>
  )
}
