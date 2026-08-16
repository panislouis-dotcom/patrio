import { type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LoginPage } from './components/LoginPage'
import { NotFound } from './components/NotFound'
import { TabBar } from './components/TabBar'
import { PropiedadesTable } from './components/PropiedadesTable'
import { PropertyDetailPage } from './components/PropertyDetailPage'
import { NewPropertyPage } from './components/NewPropertyPage'
import { PropiedadesMap } from './components/PropiedadesMap'
import { SonarTab } from './components/SonarTab'
import { ScoutingTab } from './components/ScoutingTab'
import { ProcesosTab } from './components/ProcesosTab'
import { ProcesoTemplateList } from './components/ProcesoTemplateList'
import { ProcesoInstanceList } from './components/ProcesoInstanceList'
import { ProcesoTemplateEditor } from './components/ProcesoTemplateEditor'
import { ProcesoInstanceDetail } from './components/ProcesoInstanceDetail'
import { ProcesoNodeDetail } from './components/ProcesoNodeDetail'
import { OrgTab } from './components/OrgTab'
import { InversoresTab } from './components/InversoresTab'
import { InversorDetailPage } from './components/InversorDetailPage'
import { ProveedoresPage } from './components/ProveedoresPage'
import { ProveedoresTab } from './components/ProveedoresTab'
import { TiposPage } from './components/TiposPage'
import { ComparablesTab } from './components/ComparablesTab'
import { ComparableForm } from './components/ComparableForm'
import { globalStyles, colors } from './lib/theme'
import { pageFill } from './lib/styles'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth()
  return isLoggedIn ? <>{children}</> : <Navigate to="/login" replace />
}

function AppShell() {
  const { isLoggedIn, logout } = useAuth()
  return (
    <>
      <style>{globalStyles}</style>
      {/* Columna flex de altura EXACTA: la barra ocupa lo que ocupe y la página
          se queda con el resto. Así ninguna pantalla necesita saber cuánto mide
          la barra —que cambia de alto según la sección y en /login ni se
          dibuja—, y el 49 mágico que estaba copiado en quince lugares deja de
          existir en vez de corregirse.

          `100vh` y no `minHeight`: un mínimo no es una altura definida, y sin
          altura definida `flex: 1` no acota nada — el hijo crece y la página
          vuelve a desbordarse.

          Quien scrollea es el hueco, no el documento. La barra queda FUERA de
          él, así que ya no puede taparse a sí misma: el síntoma de comerse el
          encabezado al desplazarse se vuelve imposible por construcción, no por
          un z-index bien puesto. */}
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: colors.dark }}>
        {isLoggedIn && <TabBar onLogout={logout} />}
        <div style={{ ...pageFill, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Prospectos y proyectos eran la misma cosa contada dos veces. No hay
              redirecciones de sus URLs viejas: los ids cambiaron con la fusión,
              y mandar un bookmark a la propiedad equivocada es peor que un 404. */}
          <Route path="/" element={<Navigate to="/propiedades" replace />} />

          <Route path="/propiedades" element={<ProtectedRoute><PropiedadesTable /></ProtectedRoute>} />
          <Route path="/propiedades/nueva" element={<ProtectedRoute><NewPropertyPage /></ProtectedRoute>} />
          <Route path="/propiedades/mapa" element={<ProtectedRoute><PropiedadesMap /></ProtectedRoute>} />
          <Route path="/propiedades/sonar" element={<ProtectedRoute><SonarTab /></ProtectedRoute>} />
          <Route path="/propiedades/scouting" element={<ProtectedRoute><ScoutingTab /></ProtectedRoute>} />
          <Route path="/propiedades/comparables" element={<ProtectedRoute><ComparablesTab /></ProtectedRoute>} />
          <Route path="/propiedades/comparables/nuevo" element={<ProtectedRoute><ComparableForm /></ProtectedRoute>} />
          <Route path="/propiedades/:id" element={<ProtectedRoute><PropertyDetailPage /></ProtectedRoute>} />
          <Route path="/procesos" element={<ProtectedRoute><ProcesosTab /></ProtectedRoute>}>
            <Route index element={<Navigate to="plantillas" replace />} />
            <Route path="plantillas" element={<ProcesoTemplateList />} />
            <Route path="plantillas/:tid" element={<ProcesoTemplateEditor />} />
            <Route path="tareas" element={<ProcesoInstanceList />} />
            <Route path="tareas/:iid" element={<ProcesoInstanceDetail />} />
            <Route path="tareas/:iid/nodos/:nid" element={<ProcesoNodeDetail />} />
          </Route>
          <Route path="/inversionistas" element={<ProtectedRoute><InversoresTab /></ProtectedRoute>} />
          <Route path="/inversionistas/:id" element={<ProtectedRoute><InversorDetailPage /></ProtectedRoute>} />
          <Route path="/proveedores" element={<ProtectedRoute><ProveedoresPage /></ProtectedRoute>}>
            <Route index element={<Navigate to="lista" replace />} />
            <Route path="lista" element={<ProveedoresTab />} />
            <Route path="tipos" element={<TiposPage />} />
          </Route>
          <Route path="/equipo" element={<ProtectedRoute><OrgTab /></ProtectedRoute>} />
          {/* El comodín, al final. Sin él una URL mal tecleada pintaba la barra
              y nada más — una app en blanco, indistinguible de una rota. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </div>
      </div>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
