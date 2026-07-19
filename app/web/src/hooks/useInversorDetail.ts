import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchInvestor, updateInvestor, deleteInvestor, fetchProjects,
  addProjectInvestor, updateProjectInvestment, deleteProjectInvestment,
} from '../lib/api'
import type {
  Investor, ProjectInvestor, Project,
  InvestorTemperatura, InvestorCapacidad, InvestorFuente, InvestorConfianza,
} from '../lib/types'

export function useInversorDetail(investorId: number) {
  const navigate = useNavigate()

  const [investor, setInvestor] = useState<Investor | null>(null)
  const [positions, setPositions] = useState<ProjectInvestor[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])

  // Profile fields
  const [name, setName] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [temperatura, setTemperatura] = useState<InvestorTemperatura | ''>('')
  const [capacidad, setCapacidad] = useState<InvestorCapacidad | ''>('')
  const [fuente, setFuente] = useState<InvestorFuente | ''>('')
  const [confianza, setConfianza] = useState<InvestorConfianza | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add-position form
  const [showAdd, setShowAdd] = useState(false)
  const [addProjectId, setAddProjectId] = useState<string>('')
  const [addInterested, setAddInterested] = useState<string>('')
  const [addCommitted, setAddCommitted] = useState<string>('')
  const [addFunded, setAddFunded] = useState<string>('')
  const [addRate, setAddRate] = useState<string>('12')
  const [addDate, setAddDate] = useState<string>('')
  const [adding, setAdding] = useState(false)

  // Edit-row state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editInterested, setEditInterested] = useState<string>('')
  const [editCommitted, setEditCommitted] = useState<string>('')
  const [editFunded, setEditFunded] = useState<string>('')
  const [editRate, setEditRate] = useState<string>('12')
  const [editDate, setEditDate] = useState<string>('')
  const [editReturnAmount, setEditReturnAmount] = useState<string>('')
  const [editReturnDate, setEditReturnDate] = useState<string>('')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    fetchInvestor(investorId).then(data => {
      setInvestor(data)
      setPositions(data.positions)
      setName(data.name)
      setApellidos(data.apellidos ?? '')
      setEmail(data.email)
      setPhone(data.phone)
      setNotes(data.notes ?? '')
      setTemperatura(data.temperatura ?? '')
      setCapacidad(data.capacidad ?? '')
      setFuente(data.fuente ?? '')
      setConfianza(data.confianza ?? '')
    })
    fetchProjects().then(setAllProjects)
  }, [investorId])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateInvestor(investorId, {
        name, apellidos, email, phone, notes,
        temperatura: temperatura || null, capacidad: capacidad || null,
        fuente: fuente || null, confianza: confianza || null,
      })
      setInvestor(updated)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('¿Eliminar inversionista?')) return
    try {
      await deleteInvestor(investorId)
      navigate('/inversionistas')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  async function handleAddPosition() {
    if (!addProjectId) return
    setAdding(true)
    const projectId = Number(addProjectId)
    const interested = parseFloat(addInterested) || 0
    const committed = parseFloat(addCommitted) || 0
    const funded = parseFloat(addFunded) || 0
    const rate = parseFloat(addRate) / 100 || 0.12
    const status: ProjectInvestor['status'] =
      funded > 0 ? 'fondeado' : committed > 0 ? 'comprometido' : 'interesado'
    try {
      const pos = await addProjectInvestor(projectId, {
        investorId,
        status,
        interestedAmount: interested,
        committedAmount: committed,
        fundedAmount: funded,
        interestRateAnnual: rate,
        investmentDate: addDate || null,
        notes: '',
      })
      setPositions(prev => [...prev, pos])
      setShowAdd(false)
      setAddProjectId('')
      setAddInterested('')
      setAddCommitted('')
      setAddFunded('')
      setAddRate('12')
      setAddDate('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al agregar')
    } finally {
      setAdding(false)
    }
  }

  function startEdit(pos: ProjectInvestor) {
    setEditingId(pos.id)
    setEditInterested(pos.interestedAmount ? String(pos.interestedAmount) : '')
    setEditCommitted(pos.committedAmount ? String(pos.committedAmount) : '')
    setEditFunded(pos.fundedAmount ? String(pos.fundedAmount) : '')
    setEditRate(String(Math.round(pos.interestRateAnnual * 100)))
    setEditDate(pos.investmentDate ?? '')
    setEditReturnAmount(pos.returnAmount != null ? String(pos.returnAmount) : '')
    setEditReturnDate(pos.returnDate ?? '')
  }

  async function handleSaveEdit(pos: ProjectInvestor) {
    setSavingEdit(true)
    const interested = parseFloat(editInterested) || 0
    const committed = parseFloat(editCommitted) || 0
    const funded = parseFloat(editFunded) || 0
    const rate = parseFloat(editRate) / 100 || 0.12
    const status: ProjectInvestor['status'] =
      funded > 0 ? 'fondeado' : committed > 0 ? 'comprometido' : 'interesado'
    try {
      const updated = await updateProjectInvestment(pos.projectId, pos.id, {
        status,
        interestedAmount: interested,
        committedAmount: committed,
        fundedAmount: funded,
        interestRateAnnual: rate,
        investmentDate: editDate || null,
        returnAmount: editReturnAmount ? parseFloat(editReturnAmount) : null,
        returnDate: editReturnDate || null,
      })
      setPositions(prev => prev.map(p => p.id === pos.id ? updated : p))
      setEditingId(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleRemovePosition(pos: ProjectInvestor) {
    if (!window.confirm(`¿Quitar esta inversión de "${pos.projectName || `Proyecto ${pos.projectId}`}"?`)) return
    try {
      await deleteProjectInvestment(pos.projectId, pos.id)
      setPositions(prev => prev.filter(p => p.id !== pos.id))
      if (editingId === pos.id) setEditingId(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  async function handleLiquidar(pos: ProjectInvestor) {
    const today = new Date().toISOString().split('T')[0]
    try {
      const updated = await updateProjectInvestment(pos.projectId, pos.id, {
        returnAmount: pos.expectedReturn,
        returnDate: today,
      })
      setPositions(prev => prev.map(p => p.id === pos.id ? updated : p))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al liquidar')
    }
  }

  return {
    investor, positions, allProjects,
    name, setName, apellidos, setApellidos, email, setEmail, phone, setPhone,
    notes, setNotes, temperatura, setTemperatura, capacidad, setCapacidad,
    fuente, setFuente, confianza, setConfianza,
    saving, error,
    save, handleDelete,
    showAdd, setShowAdd,
    addProjectId, setAddProjectId,
    addInterested, setAddInterested, addCommitted, setAddCommitted,
    addFunded, setAddFunded, addRate, setAddRate, addDate, setAddDate,
    adding, handleAddPosition,
    editingId, setEditingId,
    editInterested, setEditInterested, editCommitted, setEditCommitted,
    editFunded, setEditFunded, editRate, setEditRate, editDate, setEditDate,
    editReturnAmount, setEditReturnAmount, editReturnDate, setEditReturnDate,
    savingEdit,
    startEdit, handleSaveEdit, handleRemovePosition, handleLiquidar,
  }
}
