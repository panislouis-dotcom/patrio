import { type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LoginPage } from './components/LoginPage'
import { TabBar } from './components/TabBar'
import { ProspectTable } from './components/ProspectTable'
import { ProspectDetailPage } from './components/ProspectDetailPage'
import { ProspectMap } from './components/ProspectMap'
import { ProjectsTab } from './components/ProjectsTab'
import { ProjectDetailPage } from './components/ProjectDetailPage'
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
          <Route path="/" element={<Navigate to="/prospectos/tabla" replace />} />
          <Route path="/prospectos" element={<Navigate to="/prospectos/tabla" replace />} />
          <Route path="/tabla" element={<Navigate to="/prospectos/tabla" replace />} />
          <Route path="/mapa" element={<Navigate to="/prospectos/mapa" replace />} />

          <Route path="/prospectos/tabla" element={<ProtectedRoute><ProspectTable /></ProtectedRoute>} />
          <Route path="/prospectos/tabla/:id" element={<ProtectedRoute><ProspectDetailPage /></ProtectedRoute>} />
          <Route path="/prospectos/mapa" element={<ProtectedRoute><ProspectMap /></ProtectedRoute>} />
          <Route path="/prospectos/sonar" element={<ProtectedRoute><SonarTab /></ProtectedRoute>} />
          <Route path="/sonar" element={<Navigate to="/prospectos/sonar" replace />} />
          <Route path="/proyectos" element={<ProtectedRoute><ProjectsTab /></ProtectedRoute>} />
          <Route path="/proyectos/:id" element={<ProtectedRoute><ProjectDetailPage /></ProtectedRoute>} />
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
          <Route path="/equipo" element={<ProtectedRoute><OrgTab /></ProtectedRoute>} />
          <Route path="/prospectos/comparables" element={<ProtectedRoute><ComparablesTab /></ProtectedRoute>} />
          <Route path="/prospectos/comparables/nuevo" element={<ProtectedRoute><ComparableForm /></ProtectedRoute>} />
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
