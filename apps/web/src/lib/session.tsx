import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Mode, Project } from '@contracts/src'
import { dataApi } from '@/api/data'
import { assistantApi } from '@/api/assistant'
import { setToken } from '@/api/client'

interface User { id: string; name: string; email: string }
interface Ctx { user: User | null; login: (email: string, pw: string) => Promise<void>; logout: () => void; projectId: string | null; setProjectId: (id: string | null) => void; project?: Project; mode: Mode; setMode: (m: Mode) => Promise<void> }
const S = createContext<Ctx>(null as never)
export const useSession = () => useContext(S)
const ls = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* stockage indisponible */ } } }

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(() => { const u = ls.get('ais.user'); return u ? JSON.parse(u) : null })
  const [projectId, setPid] = useState<string | null>(() => ls.get('ais.project'))
  const projects = useQuery({ queryKey: ['projects'], queryFn: dataApi.projects, enabled: !!user })
  const modeQ = useQuery({ queryKey: ['mode', projectId], queryFn: () => assistantApi.mode(projectId!), enabled: !!user && !!projectId })
  useEffect(() => { if (user) setToken('mock') }, [user])
  const login = async (email: string, pw: string) => { const r = await dataApi.login(email, pw); setToken(r.access_token); setUser(r.user); ls.set('ais.user', JSON.stringify(r.user)) }
  const logout = () => { setUser(null); setPid(null); setToken(null); ls.set('ais.user', null); ls.set('ais.project', null); qc.clear() }
  const setProjectId = (id: string | null) => { setPid(id); ls.set('ais.project', id) }
  const setMode = async (m: Mode) => { await assistantApi.setMode(projectId!, m); qc.invalidateQueries({ queryKey: ['mode'] }); qc.invalidateQueries({ queryKey: ['audit'] }); qc.invalidateQueries({ queryKey: ['workflow'] }) }
  return <S.Provider value={{ user, login, logout, projectId, setProjectId, project: projects.data?.find((p) => p.id === projectId), mode: modeQ.data?.mode ?? 'guided', setMode }}>{children}</S.Provider>
}
