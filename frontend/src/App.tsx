import { Routes, Route, Navigate } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { ProspectTable } from './components/ProspectTable'
import { ProspectDetailPage } from './components/ProspectDetailPage'
import { ProspectMap } from './components/ProspectMap'
import { QualityTab } from './components/QualityTab'
import { globalStyles, colors } from './lib/theme'

export default function App() {
  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ minHeight: '100vh', background: colors.dark }}>
        <TabBar />
        <Routes>
          <Route path="/" element={<Navigate to="/tabla" replace />} />
          <Route path="/tabla" element={<ProspectTable />} />
          <Route path="/tabla/:id" element={<ProspectDetailPage />} />
          <Route path="/mapa" element={<ProspectMap />} />
          <Route path="/calidad" element={<QualityTab />} />
        </Routes>
      </div>
    </>
  )
}
