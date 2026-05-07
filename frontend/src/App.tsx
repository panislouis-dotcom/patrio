import { Routes, Route, Navigate } from 'react-router-dom'
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
import { OrgTab } from './components/OrgTab'
import { globalStyles, colors } from './lib/theme'

export default function App() {
  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ minHeight: '100vh', background: colors.dark }}>
        <TabBar />
        <Routes>
          <Route path="/" element={<Navigate to="/prospectos/tabla" replace />} />
          <Route path="/prospectos" element={<Navigate to="/prospectos/tabla" replace />} />
          <Route path="/prospectos/tabla" element={<ProspectTable />} />
          <Route path="/prospectos/tabla/:id" element={<ProspectDetailPage />} />
          <Route path="/prospectos/mapa" element={<ProspectMap />} />
          <Route path="/proyectos" element={<ProjectsTab />} />
          <Route path="/proyectos/:id" element={<ProjectDetailPage />} />
          <Route path="/sonar" element={<SonarTab />} />
          <Route path="/procesos" element={<ProcesosTab />}>
            <Route index element={<Navigate to="plantillas" replace />} />
            <Route path="plantillas" element={<ProcesoTemplateList />} />
            <Route path="plantillas/:tid" element={<ProcesoTemplateEditor />} />
            <Route path="instancias" element={<ProcesoInstanceList />} />
            <Route path="instancias/:iid" element={<ProcesoInstanceDetail />} />
          </Route>
          <Route path="/equipo" element={<OrgTab />} />
          <Route path="/tabla" element={<Navigate to="/prospectos/tabla" replace />} />
          <Route path="/mapa" element={<Navigate to="/prospectos/mapa" replace />} />
        </Routes>
      </div>
    </>
  )
}
