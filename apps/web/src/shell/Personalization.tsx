import type { MouseEvent } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Lightbulb, Moon, Sun, XCircle } from 'lucide-react'
import { Button, Card, PageHeader } from '@/components/ui'
import { AUTO_NAME, AUTO_SHORTCUT } from '@/modules/auto/constants'
import { simulate, simulateResolve } from '@/modules/auto/autoBus'
import { DARK_PALETTES, setDarkPalette, setTheme, useDarkPalette, useTheme, type DarkPalette, type Theme } from '@/lib/theme'
import { clsx } from '@/lib/format'

const center = (e: MouseEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

/** Mini-aperçu d'une palette : fond, lueurs, panneau et deux nœuds reliés, aux couleurs réelles de la palette. */
function PalettePreview({ p }: { p: (typeof DARK_PALETTES)[number] }) {
  return (
    <div className="relative h-28 overflow-hidden rounded-lg" style={{ background: p.bg }} aria-hidden="true">
      {p.glows.map((g, i) => <span key={i} className="absolute h-20 w-20 rounded-full blur-2xl" style={{ background: g, opacity: 0.55, left: ['-10%', '60%', '30%'][i], top: ['-20%', '10%', '55%'][i] }} />)}
      <span className="absolute inset-y-0 left-0 w-10 border-r" style={{ background: p.surface, borderColor: `${p.accent}33` }} />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 112" preserveAspectRatio="none">
        <path d="M86 40 C110 40 110 72 134 72" fill="none" stroke={p.accent} strokeWidth="2" />
      </svg>
      <span className="absolute left-14 top-6 h-7 w-9 rounded-md border" style={{ background: p.surface, borderColor: p.accent }} />
      <span className="absolute right-6 top-14 h-7 w-9 rounded-md border" style={{ background: p.surface, borderColor: `${p.accent}88` }} />
      <span className="absolute bottom-2 right-2 h-3.5 w-10 rounded" style={{ background: p.accent }} />
    </div>)
}

/** Section où l'utilisateur personnalise l'application (affichage, thème du mode sombre…). */
export function Personalization() {
  const theme = useTheme(); const palette = useDarkPalette()
  const modes: { id: Theme; label: string; icon: typeof Sun; desc: string }[] = [
    { id: 'light', label: 'Clair', icon: Sun, desc: 'Fond clair, idéal en journée.' },
    { id: 'dark', label: 'Sombre', icon: Moon, desc: 'Reposant pour les yeux, avec le thème choisi ci-dessous.' },
  ]
  const pick = (id: DarkPalette, e: MouseEvent<HTMLElement>) => setDarkPalette(id, center(e))
  return (
    <>
      <PageHeader title="Personnalisation" subtitle="Adaptez l'apparence d'AI Studio à vos goûts. Vos choix sont mémorisés sur ce navigateur." />
      <div className="space-y-5">
        <Card title="Mode d'affichage">
          <div className="grid gap-3 sm:grid-cols-2">{modes.map((m) => {
            const on = theme === m.id
            return (
              <button key={m.id} onClick={(e) => setTheme(m.id, center(e))} aria-pressed={on}
                className={clsx('card flex items-start gap-3 p-4 text-left', on ? 'border-brand-500 ring-1 ring-brand-500' : 'hover:border-slate-400')}>
                <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', on ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}><m.icon className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="flex items-center gap-2 font-semibold text-slate-800">{m.label}{on && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">actif</span>}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{m.desc}</span></span>
              </button>)
          })}</div>
        </Card>

        <div data-auto-target="settings.palette"><Card title="Thème du mode sombre">
          <p className="mb-3 text-xs text-slate-500">Ces thèmes changent uniquement les couleurs du mode sombre (fond, panneaux, accents, grille du canevas). {theme === 'light' && <b className="text-slate-600">Choisir un thème active le mode sombre.</b>}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{DARK_PALETTES.map((p, i) => {
            const on = palette === p.id && theme === 'dark'
            return (
              <motion.button key={p.id} onClick={(e) => pick(p.id, e)} aria-pressed={on} aria-label={`Thème sombre ${p.label}`}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.35 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }}
                className={clsx('card relative p-2.5 text-left', on ? 'ring-2' : 'hover:border-slate-400')}
                style={on ? { borderColor: p.accent, ['--tw-ring-color' as string]: p.accent } : undefined}>
                <PalettePreview p={p} />
                <div className="mt-2 flex items-center gap-2 px-0.5">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.accent }} />
                  <span className="font-semibold text-slate-800">{p.label}</span>
                  {palette === p.id && <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: p.accent }}><Check className="h-3 w-3" /></span>}
                </div>
                <p className="mt-0.5 px-0.5 text-xs text-slate-500">{p.mood}</p>
              </motion.button>)
          })}</div>
        </Card></div>

        <div data-auto-target="settings.auto"><Card title={`${AUTO_NAME}, votre compagnon`}>
          <p className="text-sm text-slate-600">
            {AUTO_NAME} vit en bas de l’écran et montre ce que l’agent remarque en arrière-plan. Affichez-le ou masquez-le avec <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold">{AUTO_SHORTCUT}</kbd>.
            Clic : discuter avec l’assistant · Clic droit : suggestions · Ampoule : une idée l’attend. Les erreurs le font revenir même masqué.
          </p>
          <p className="mb-2 mt-4 text-xs font-medium text-slate-500">Aperçu : événements simulés, en attendant l’agent réel</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => simulate('tip')}><Lightbulb className="h-3.5 w-3.5" />Simuler une idée</Button>
            <Button size="sm" variant="secondary" onClick={() => simulate('warning')}><AlertTriangle className="h-3.5 w-3.5" />Simuler un avertissement</Button>
            <Button size="sm" variant="secondary" onClick={() => simulate('error')}><XCircle className="h-3.5 w-3.5" />Simuler une erreur</Button>
            <Button size="sm" variant="ghost" onClick={() => simulateResolve()}><Check className="h-3.5 w-3.5" />Résoudre l’erreur</Button>
          </div>
        </Card></div>
      </div>
    </>)
}
