import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { useSession } from '@/lib/session'
import { Button, ErrorBanner } from '@/components/ui'

export function Login() {
  const { user, login } = useSession(); const nav = useNavigate()
  const [email, setEmail] = useState('mohamed@emsi.ma'); const [pw, setPw] = useState('demo'); const [err, setErr] = useState<unknown>(); const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/projects" replace />
  return (
    <div className="relative flex h-full items-center justify-center p-4"><div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <motion.form initial={{ opacity: 0, y: 40, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 22 }} className="card relative z-10 w-full max-w-sm space-y-4 p-7 shadow-xl" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(undefined); try { await login(email, pw); nav('/projects') } catch (x) { setErr(x) } finally { setBusy(false) } }}>
        <div className="flex items-center gap-3"><motion.span animate={{ rotate: [0, 8, -8, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-sky-400 text-white shadow-lg"><Sparkles className="h-5 w-5" /></motion.span>
          <div><h1 className="bg-gradient-to-r from-brand-900 to-brand-500 bg-clip-text text-xl font-bold text-transparent">AI Studio</h1><p className="text-xs text-slate-500">AutoML & Deep Learning assistés par IA</p></div></div>
        <ErrorBanner error={err} />
        <div><label className="label" htmlFor="em">Email</label><input id="em" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label" htmlFor="pw">Mot de passe</label><input id="pw" className="input" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <Button type="submit" className="w-full" loading={busy}>Se connecter</Button>
        <p className="text-center text-xs text-slate-400">Démo : n'importe quel email / mot de passe.</p>
      </motion.form>
    </div>)
}
