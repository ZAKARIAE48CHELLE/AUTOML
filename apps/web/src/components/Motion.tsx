import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { animate, motion, AnimatePresence } from 'framer-motion'

/** Transition de page : fondu + glissement à chaque changement de route. */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <motion.div key={pathname} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>
}

const NUM = /^-?[\d\s  ]+([.,]\d+)?$/
/** Compteur animé : accepte un nombre ou une chaîne numérique (format fr-FR) ; tout autre contenu est affiché tel quel. */
export function CountUp({ value }: { value: ReactNode }) {
  const isNum = typeof value === 'number' || (typeof value === 'string' && NUM.test(value.trim()))
  const target = isNum ? Number(String(value).replace(/[\s  ]/g, '').replace(',', '.')) : NaN
  const decimals = isNum && typeof value === 'string' && /[.,]\d+$/.test(value.trim()) ? value.trim().split(/[.,]/).pop()!.length : typeof value === 'number' && !Number.isInteger(value) ? 2 : 0
  const [shown, setShown] = useState(isNum ? 0 : target)
  useEffect(() => { if (!isNum) return; const c = animate(0, target, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(v) }); return () => c.stop() }, [target, isNum])
  if (!isNum) return <>{value}</>
  return <>{decimals ? shown.toFixed(decimals) : Math.round(shown).toLocaleString('fr-FR')}</>
}

/** Barre de chargement fine en haut de l'écran, visible tant qu'une requête est en cours. */
export function TopLoader() {
  const busy = useIsFetching() + useIsMutating() > 0
  const [show, setShow] = useState(false)
  useEffect(() => { if (busy) { setShow(true); return } const t = setTimeout(() => setShow(false), 350); return () => clearTimeout(t) }, [busy])
  return (
    <AnimatePresence>{show && <motion.div key="bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden" role="progressbar" aria-label="Chargement">
      <div className="h-full w-1/4 rounded-full bg-gradient-to-r from-brand-500 via-sky-400 to-indigo-400" style={{ animation: 'loadbar 1.1s ease-in-out infinite' }} /></motion.div>}</AnimatePresence>)
}
