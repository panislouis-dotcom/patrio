import { type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LoginPage } from './components/LoginPage'
import { TabBar } from './components/TabBar'
import { PropiedadesTable } from './components/PropiedadesTable'
import { PropertyDetailPage } from './components/PropertyDetailPage'
import { NewPropertyPage } from './components/NewPropertyPage'
import { PropiedadesMap } from './components/PropiedadesMap'
import { SonarTab } from './components/SonarTab'
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
import { AnalysisView } from './components/AnalysisView'
import { globalStyles, colors } from './lib/theme'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth()
  return isLoggedIn ? <>{children}</> : <Navigate to="/login" replace />
}

function AppShell() {
  const { isLoggedIn, logout } = useAuth()
  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ minHeight: '100vh', background: colors.dark }}>
        {isLoggedIn && <TabBar onLogout={logout} />}
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
          <Route path="/analyses/:id" element={<ProtectedRoute><AnalysisView /></ProtectedRoute>} />
        </Routes>
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
