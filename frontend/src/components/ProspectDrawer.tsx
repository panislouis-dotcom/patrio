import type { Prospect } from '../lib/types'
interface Props { prospect: Prospect | null; onClose: () => void; onOpenDetail: (id: number) => void }
export function ProspectDrawer({ prospect, onClose, onOpenDetail: _onOpenDetail }: Props) {
  if (!prospect) return null
  return <div style={{position:'fixed',right:0,top:0,width:'380px',height:'100vh',background:'#1e2e1e',padding:'24px',color:'#F2F0EB',zIndex:200}}>
    <button onClick={onClose} style={{color:'#7A7260',background:'none',border:'none',cursor:'pointer',marginBottom:'16px'}}>✕ Cerrar</button>
    <div>{prospect.name}</div>
  </div>
}
