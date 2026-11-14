import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import { useTheme } from '@/lib/theme'
import { AUTO_ENABLED_KEY, AUTO_NAME, AUTO_SHORTCUT } from './constants'
import { autoBus, type AutoNotice } from './autoBus'
import { createAutoEngine, type Anchor, type AutoEngine } from './engine'
import { contextRecs, type AutoMenuItem } from './recs'
import { AutoMenu } from './AutoMenu'
import { TipCard } from './TipCard'
import { FloatingChat } from './FloatingChat'
import { createGuide, type Guide } from './guide'

const readEnabled = () => { try { return localStorage.getItem(AUTO_ENABLED_KEY) !== '0' } catch { return true } }
const writeEnabled = (on: boolean) => { try { localStorage.setItem(AUTO_ENABLED_KEY, on ? '1' : '0') } catch { /* stockage indisponible */ } }
const pick = <T,>(a: readonly T[]): T => a[(Math.random() * a.length) | 0]
/** Alt+A (sur AZERTY comme sur QWERTY ; repli sur la touche physique si Alt produit un autre caractère, ex. macOS). */
const isShortcut = (e: KeyboardEvent) =>
  e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat && (e.key.toLowerCase() === 'a' || (!/^[a-z]$/i.test(e.key) && e.code === 'KeyA'))
const inEditor = () => !!document.querySelector('[data-testid="workflow-editor"]')

const BOOT = `Salut, moi c’est ${AUTO_NAME} !`
const SUMMON = ['Me revoilà !', 'Tu m’as appelé ?', 'Présent !']
const BYE = ['À plus tard !', 'Je file !', 'Bye bye !']
/** Délai sans clic ni frappe avant de présenter une astuce : on n'interrompt pas un glisser ou une saisie. */
const IDLE_BEFORE_TIP = 1500

/**
 * Auto, le corps visible de l'agent : il ne décide rien, il montre (apparaît, s'endort, allume une ampoule, signale une erreur).
 * Monté une seule fois dans le Layout, rendu dans document.body par-dessus l'interface (pointer-events: none sauf sur Auto).
 */
export function AutoMascot({ onOpenChat }: { onOpenChat: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null), bubbleRef = useRef<HTMLDivElement>(null), textRef = useRef<HTMLSpanElement>(null)
  const hitRef = useRef<HTMLButtonElement>(null), bulbHitRef = useRef<HTMLButtonElement>(null)
  const eng = useRef<AutoEngine | null>(null)
  const enabled = useRef(readEnabled())
  const setEnabled = (on: boolean) => { enabled.current = on; writeEnabled(on) }
  const chatCb = useRef(onOpenChat); chatCb.current = onOpenChat

  const [menu, setMenu] = useState<Anchor | null>(null)
  const [tipAt, setTipAt] = useState<Anchor | null>(null)
  const [chat, setChat] = useState<'left' | 'right' | null>(null)
  const [bulb, setBulbState] = useState<AutoNotice | null>(null); const bulbRef = useRef(bulb)
  const setBulb = (n: AutoNotice | null) => { bulbRef.current = n; setBulbState(n) }
  const queue = useRef<AutoNotice[]>([]) // avertissements / astuces en attente : une seule ampoule à la fois
  const errors = useRef<AutoNotice[]>([])
  const [errCount, setErrCount] = useState(0)
  const [, rerender] = useState(0)

  const theme = useTheme(), reduced = useReducedMotion(), nav = useNavigate(), { pathname } = useLocation()
  const guide = useRef<Guide | null>(null)
  const navRef = useRef(nav); navRef.current = nav
  const reducedRef = useRef(!!reduced); reducedRef.current = !!reduced

  const openChat = useCallback(() => {
    // Dans l'éditeur plein écran, le panneau latéral de l'assistant est masqué : Auto ouvre un chat flottant.
    if (inEditor()) setChat((eng.current?.anchor().x ?? 0) > window.innerWidth / 2 ? 'right' : 'left')
    else chatCb.current()
    window.setTimeout(() => eng.current?.rescan(), 450) // le panneau qui s'ouvre devient une zone à éviter
  }, [])

  useEffect(() => {
    const e = createAutoEngine(
      { canvas: canvasRef.current!, bubble: bubbleRef.current!, bubbleText: textRef.current!, hit: hitRef.current!, bulbHit: bulbHitRef.current! },
      {
        onChat: openChat,
        onMenu: (a) => { setTipAt(null); setMenu(a) },
        onBulb: (a) => { setMenu(null); setTipAt(a) },
        onPresence: (p) => { if (p === 'leaving' || p === 'away') { setMenu(null); setTipAt(null) } },
      })
    eng.current = e
    const g = createGuide({ engine: e, navigate: (to) => navRef.current(to), pathname: () => window.location.pathname, reduced: () => reducedRef.current })
    guide.current = g
    const boot = enabled.current ? window.setTimeout(() => e.enter(BOOT), 700) : 0
    return () => { clearTimeout(boot); g.destroy(); guide.current = null; e.destroy(); eng.current = null }
  }, [openChat])

  useEffect(() => { eng.current?.setDark(theme === 'dark') }, [theme])
  useEffect(() => { guide.current?.onRoute(pathname) }, [pathname])
  useEffect(() => { eng.current?.setReducedMotion(!!reduced) }, [reduced])
  useEffect(() => { eng.current?.setBulb(!!bulb) }, [bulb])
  useEffect(() => { eng.current?.setHold(!!bulb || errCount > 0 || !!menu || !!tipAt || !!chat) }, [bulb, errCount, menu, tipAt, chat])

  // Événements de l'agent (faux pour l'instant).
  useEffect(() => autoBus.subscribe((ev) => {
    const e = eng.current; if (!e) return
    const away = () => e.presence() === 'away' || e.presence() === 'leaving'
    if (ev.type === 'point') { setMenu(null); setTipAt(null); void guide.current?.point(ev); return }
    if (ev.type === 'notice') {
      const n = ev.notice
      if (n.level === 'error') { // les erreurs interrompent tout de suite, même si Auto est masqué
        errors.current = [...errors.current, n]; setErrCount(errors.current.length)
        e.setAlert(errors.current[0].title)
        if (away()) e.enter()
      } else { queue.current = [...queue.current, n]; rerender((x) => x + 1) }
      return
    }
    const before = errors.current.length
    errors.current = errors.current.filter((n) => n.id !== ev.id)
    if (errors.current.length !== before) {
      setErrCount(errors.current.length)
      e.setAlert(errors.current[0]?.title ?? null)
      if (!errors.current.length) {
        e.say('Ouf, c’est réglé !', 2000)
        // Masqué par l'utilisateur, il n'était revenu que pour l'erreur : il repart.
        if (!enabled.current) window.setTimeout(() => { if (!errors.current.length && !enabled.current) eng.current?.leave('auto') }, 2300)
      }
    }
    queue.current = queue.current.filter((n) => n.id !== ev.id); rerender((x) => x + 1)
    if (bulbRef.current?.id === ev.id) { setBulb(null); setTipAt(null) }
  }), [])

  // Une astuce attend que l'utilisateur soit inactif (pas en train de glisser ni de taper), une seule ampoule à la fois.
  useEffect(() => {
    let lastInput = Date.now(), down = false
    const input = () => { lastInput = Date.now() }
    const onDown = () => { down = true; lastInput = Date.now() }
    const onUp = () => { down = false }
    window.addEventListener('keydown', input, true); window.addEventListener('wheel', input, { passive: true })
    window.addEventListener('pointerdown', onDown, true); window.addEventListener('pointerup', onUp, true); window.addEventListener('pointercancel', onUp, true)
    const iv = window.setInterval(() => {
      const e = eng.current
      if (!e || !enabled.current || bulbRef.current || !queue.current.length || down || Date.now() - lastInput < IDLE_BEFORE_TIP) return
      const [n, ...rest] = queue.current; queue.current = rest
      setBulb(n)
      const line = n.level === 'warning' ? 'Psst, regarde ça !' : 'J’ai une idée !'
      if (e.presence() === 'away' || e.presence() === 'leaving') e.enter(line); else e.say(line, 1800)
    }, 400)
    return () => {
      clearInterval(iv)
      window.removeEventListener('keydown', input, true); window.removeEventListener('wheel', input)
      window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onUp, true)
    }
  }, [])

  // Alt+A : afficher / masquer.
  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (!isShortcut(ev)) return
      ev.preventDefault()
      const e = eng.current; if (!e) return
      const p = e.presence()
      if (p === 'away' || p === 'leaving') { setEnabled(true); e.enter(pick(SUMMON)); return }
      if (!enabled.current) { setEnabled(true); e.say('D’accord, je reste !', 1600); return } // revenu pour une erreur alors qu'il était masqué
      setEnabled(false)
      if (bulbRef.current) { queue.current = [bulbRef.current, ...queue.current]; setBulb(null) } // l'ampoule attendra son retour
      setMenu(null); setTipAt(null)
      e.say(pick(BYE), 1200); e.leave('auto')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const dismissBulb = () => { setBulb(null); setTipAt(null) }
  const closeMenu = useCallback(() => setMenu(null), [])
  const closeTip = useCallback(() => setTipAt(null), [])
  const closeChat = useCallback(() => setChat(null), [])
  const pickItem = (i: AutoMenuItem) => {
    setMenu(null)
    if (!i.context && i.level !== 'error') {
      if (bulbRef.current?.id === i.id) setBulb(null)
      queue.current = queue.current.filter((n) => n.id !== i.id)
    }
    if (i.to) nav(i.to)
  }
  const menuItems: AutoMenuItem[] = menu ? [...errors.current, ...(bulb ? [bulb] : []), ...queue.current, ...contextRecs(pathname)] : []

  return createPortal(
    <>
      <canvas ref={canvasRef} data-auto aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[45]" />
      <div ref={bubbleRef} data-auto aria-live="polite" style={{ opacity: 0 }}
        className="pointer-events-none fixed left-0 top-0 z-[46] w-max max-w-[15rem] rounded-xl bg-white px-3 py-1.5 text-[13px] font-semibold leading-snug text-slate-800 shadow-lg ring-1 ring-slate-200 transition-opacity duration-150 motion-reduce:transition-none data-[tone=error]:bg-red-50 data-[tone=error]:text-red-800 data-[tone=error]:ring-red-200">
        <span ref={textRef} />
        <i aria-hidden="true" className="absolute -bottom-1 -ml-[5px] h-2.5 w-2.5 rotate-45 rounded-br-sm bg-inherit" style={{ left: 'calc(50% + var(--tx, 0px))' }} />
      </div>
      <button ref={hitRef} data-auto type="button" style={{ display: 'none' }}
        aria-label={`${AUTO_NAME}, votre assistant. Entrée : discuter. Menu contextuel : suggestions. ${AUTO_SHORTCUT} : afficher ou masquer.`}
        className="fixed left-0 top-0 z-[46] cursor-grab touch-none rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500 active:cursor-grabbing" />
      <button ref={bulbHitRef} data-auto type="button" style={{ display: 'none' }} aria-label={`Voir la suggestion d’${AUTO_NAME}`}
        className="fixed left-0 top-0 z-[46] cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber-400" />
      {menu && <AutoMenu at={menu} items={menuItems} onPick={pickItem} onClose={closeMenu} />}
      {tipAt && bulb && <TipCard at={tipAt} notice={bulb} onClose={closeTip} onDismiss={dismissBulb} onGo={() => { const to = bulb.to; dismissBulb(); if (to) nav(to) }} />}
      {chat && <FloatingChat side={chat} onClose={closeChat} />}
    </>,
    document.body,
  )
}
