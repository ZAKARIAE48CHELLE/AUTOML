import { useState } from 'react'
import { NavLink, Outlet, Navigate, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Database, Cpu, Bot, Workflow, Package, LogOut, MessageSquare, ShieldCheck, ChevronsUpDown, Sparkles } from 'lucide-react'
import { useSession } from '@/lib/session'
import { SimulationBanner } from '@/components/ui'
import { PageTransition, TopLoader } from '@/components/Motion'
import { dataApi } from '@/api/data'
import { ChatPanel } from '@/modules/assistant/ChatPanel'
import { clsx } from '@/lib/format'
import { ThemeToggle } from '@/lib/theme'

const NAV = [
  { to: '/data', label: 'Données', icon: Database, owner: 'E1' },
  { to: '/training', label: 'Entraînement', icon: Cpu, owner: 'E2' },
  { to: '/assistant', label: 'Assistant', icon: Bot, owner: 'E3' },
  { to: '/studio', label: 'Studio', icon: Workflow, owner: 'E4' },
  { to: '/studio/registry', label: 'Registre', icon: Package, owner: 'E4' },
]
const MODE: Record<string, { l: string; c: string }> = { auto: { l: 'Auto', c: 'bg-purple-100 text-purple-800' }, guided: { l: 'Guidé', c: 'bg-blue-100 text-blue-800' }, expert: { l: 'Expert', c: 'bg-slate-200 text-slate-800' } }

export function Layout() {
  const { user, logout, projectId, setProjectId, project, mode } = useSession()
  const nav = useNavigate(); const [chat, setChat] = useState(false)
  const projects = useQuery({ queryKey: ['projects'], queryFn: dataApi.projects })
  if (!user) return <Navigate to="/login" replace />
  if (!projectId) return <Navigate to="/projects" replace />
  return (
    <div className="relative flex h-full">
      <TopLoader />
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <motion.aside initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="relative z-10 flex w-56 shrink-0 flex-col border-r border-slate-200/80 bg-white/80 backdrop-blur">
        <Link to="/projects" className="flex items-center gap-2 px-4 py-4"><motion.span whileHover={{ rotate: 18, scale: 1.15 }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-sky-400 text-white shadow-md"><Sparkles className="h-4 w-4" /></motion.span><span className="bg-gradient-to-r from-brand-900 to-brand-500 bg-clip-text text-lg font-bold text-transparent">AI Studio</span></Link>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map((n, i) => (
            <motion.div key={n.to} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06, duration: 0.4 }}>
              <NavLink to={n.to} end={n.to === '/studio'} className={({ isActive }) => clsx('relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'text-brand-700' : 'text-slate-600 hover:bg-brand-50/70 hover:text-brand-700')}>
                {({ isActive }) => <>{isActive && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-brand-50 ring-1 ring-brand-100" transition={{ type: 'spring', stiffness: 450, damping: 34 }} />}
                  <n.icon className="nav-icon relative h-4 w-4" /><span className="relative">{n.label}</span><span className="relative ml-auto rounded bg-slate-100 px-1 text-[10px] text-slate-400">{n.owner}</span></>}
              </NavLink></motion.div>))}
        </nav>
        <div className="border-t border-slate-200/80 p-3 text-xs"><div className="truncate font-medium text-slate-700">{user.name}</div><button onClick={() => { logout(); nav('/login') }} className="mt-1 flex items-center gap-1 text-slate-500 transition hover:text-red-600"><LogOut className="h-3 w-3" />Déconnexion</button></div>
      </motion.aside>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <SimulationBanner />
        <header className="flex items-center gap-3 border-b border-slate-200/80 bg-white/70 px-5 py-2.5 backdrop-blur">
          <label className="flex items-center gap-1.5 text-sm"><span className="sr-only">Projet</span>
            <select className="rounded-lg border border-slate-300 bg-white py-1 pl-2 pr-6 text-sm font-medium transition hover:border-brand-500" value={projectId} onChange={(e) => { setProjectId(e.target.value); nav('/data') }}>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronsUpDown className="-ml-6 h-3.5 w-3.5 text-slate-400" /></label>
          <span className="text-xs text-slate-400">{project?.role}</span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link to="/assistant/settings" title="Mode de l'assistant : détermine les approbations demandées"><motion.span key={mode} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }} whileHover={{ scale: 1.06 }} className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', MODE[mode].c)}><ShieldCheck className="h-3.5 w-3.5" />Mode {MODE[mode].l}</motion.span></Link>
            <button onClick={() => setChat(!chat)} className={clsx('btn inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm', chat ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white hover:bg-slate-50')}><MessageSquare className="h-4 w-4" />Assistant</button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-auto p-6"><PageTransition><Outlet /></PageTransition></main>
          <AnimatePresence>{chat && <motion.aside key="chat" initial={{ width: 0, opacity: 0 }} animate={{ width: 384, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 34 }} className="flex shrink-0 flex-col overflow-hidden border-l border-slate-200/80 bg-white/90 backdrop-blur" aria-label="Assistant"><div className="flex h-full w-96 flex-col"><ChatPanel compact /></div></motion.aside>}</AnimatePresence>
        </div>
      </div>
    </div>)
}
