import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { SessionProvider } from './lib/session'
import { App } from './App'
import { Celebrations, Toaster, celebrate, toast, type ToastTone } from './components/Feedback'
import '@xyflow/react/dist/style.css'
import './styles.css'

/**
 * Retour visuel des actions : une mutation déclare `meta.toast` (texte, ou fonction du résultat) pour
 * afficher une notification au succès, et éventuellement `celebrate` pour des confettis.
 * Les erreurs restent affichées par les pages (ErrorBanner) — pas de doublon ici.
 */
export type ToastMeta = string | { title: string; detail?: string; tone?: ToastTone; celebrate?: 'small' | 'big' } | undefined
declare module '@tanstack/react-query' {
  interface Register { mutationMeta: { toast?: ToastMeta | ((data: any, variables: any) => ToastMeta) } }
}
const mutationCache = new MutationCache({
  onSuccess: (data, variables, _ctx, m) => {
    const raw = m.meta?.toast; const t = typeof raw === 'function' ? raw(data, variables) : raw
    if (!t) return
    if (typeof t === 'string') { toast(t); return }
    toast(t.title, { tone: t.tone ?? (t.celebrate ? 'celebrate' : 'success'), detail: t.detail })
    if (t.celebrate) celebrate(t.celebrate)
  },
})

const qc = new QueryClient({ mutationCache, defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } } })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={qc}><BrowserRouter><MotionConfig reducedMotion="user"><SessionProvider><App /><Toaster /><Celebrations /></SessionProvider></MotionConfig></BrowserRouter></QueryClientProvider></React.StrictMode>)
