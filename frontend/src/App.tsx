import { Routes, Route, Navigate } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { ProspectTable } from './components/ProspectTable'
import { ProspectDetailPage } from './components/ProspectDetailPage'
import { ProspectMap } from './components/ProspectMap'
import { ProjectsTab } from './components/ProjectsTab'
import { SonarTab } from './components/SonarTab'
import { globalStyles, colors } from './lib/theme'

export default function App() {
  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ minHeight: '100vh', background: colors.dark }}>
        <TabBar />
        <Routes>
          <Route path="/" element={<Navigate to="/prospectos/tabla" replace />} />
          <Route path="/prospectos/tabla" element={<ProspectTable />} />
          <Route path="/prospectos/tabla/:id" element={<ProspectDetailPage />} />
          <Route path="/prospectos/mapa" element={<ProspectMap />} />
          <Route path="/proyectos" element={<ProjectsTab />} />
          <Route path="/sonar" element={<SonarTab />} />
          <Route path="/tabla" element={<Navigate to="/prospectos/tabla" replace />} />
          <Route path="/mapa" element={<Navigate to="/prospectos/mapa" replace />} />
        </Routes>
      </div>
    </>
  )
}
