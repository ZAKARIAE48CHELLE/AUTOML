/* Moteur de la mascotte : rig du bonhomme, cape, visage, particules et comportements, portés depuis auto/auto-demo.html.
 * TypeScript pur dans requestAnimationFrame : aucune valeur par image ne passe par l'état React.
 * Le monde est en unités (1 unité = S pixels) ; le sol est le bord bas de la fenêtre (GY). */

import { crossesBlocked, freeSegments, homeX, isBlocked, mergeSpans, type Span } from './ground'

export type Presence = 'away' | 'entering' | 'present' | 'leaving'
/** Point d'ancrage en pixels écran, juste au-dessus de la tête (menus, carte de suggestion). */
export interface Anchor { x: number; y: number }
export interface AutoEls { canvas: HTMLCanvasElement; bubble: HTMLElement; bubbleText: HTMLElement; hit: HTMLElement; bulbHit: HTMLElement }
export interface AutoHooks {
  onChat(): void
  onMenu(at: Anchor): void
  onBulb(at: Anchor): void
  onPresence(p: Presence): void
}
export interface AutoEngine {
  /** Fait apparaître Auto (il grimpe par le bord bas). Déjà là : il dit simplement `greet`. */
  enter(greet?: string): void
  /** Auto s'en va : saut par-dessus le bord, ou il redescend en s'agrippant. */
  leave(how?: 'jump' | 'climb' | 'auto'): void
  presence(): Presence
  say(text: string, ms?: number): void
  setDark(on: boolean): void
  setReducedMotion(on: boolean): void
  /** Quelque chose attend l'utilisateur (ampoule, menu, chat ouvert…) : Auto ne s'endort pas et ne part pas. */
  setHold(on: boolean): void
  setBulb(on: boolean): void
  /** Message d'erreur affiché en continu (null : plus d'erreur). */
  setAlert(msg: string | null): void
  rescan(): void
  anchor(): Anchor
  /** Vole à côté d'un élément (rect en pixels écran, relu à chaque image) et le désigne du bras. */
  guide(opts: { rect: () => DOMRect | null; text: string; onArrive?: () => void }): void
  /** Fin du guidage : retour au coin de repos. */
  endGuide(): void
  destroy(): void
}

/** Secondes sans interaction avant qu'Auto s'endorme, puis secondes de sommeil avant qu'il disparaisse. */
export const IDLE_SLEEP = 20
export const SLEEP_LEAVE = 6

/** Éléments de l'interface collés au bord bas sur lesquels Auto ne marche pas. */
const AVOID = 'aside, [role="status"], .react-flow__controls, [data-auto-avoid]'

type St = 'hidden' | 'climbUp' | 'climbDown' | 'fadeIn' | 'fadeOut' | 'idle' | 'walk' | 'air' | 'held' | 'dizzy' | 'sleep' | 'warn' | 'spray' | 'portal' | 'fly' | 'guide'
/** Marge du sol au-dessus du bord bas (unités) : les pieds ne sont jamais rognés. */
const GROUND_PAD = .8
type Pt = { x: number; y: number }
interface Particle { type: string; x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; col: string; size: number; ang: number; gy?: number }

const TAU = Math.PI * 2, G = 380
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(a: readonly T[]): T => a[(Math.random() * a.length) | 0]
const ease = (dt: number, k: number) => Math.min(1, dt * k)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u) }

const PAL = { c: '#4f46e5', dk: '#3730a3', t1: '#ffffff', t2: '#7df9ff' }
const INK = '#14131a', LEG = 2.3, ARM = 2.2, HEADR = 1.9
const HANG: Pt[] = [{ x: -.4, y: 7.8 }, { x: -6.6, y: 6.2 }]
const STREAM: Pt[] = [{ x: 7, y: .6 }, { x: 7.8, y: 5.6 }]
const LIE: Pt[] = [{ x: -4.8, y: .9 }, { x: -5.6, y: 1.6 }]
const DANGLE = new Set<St>(['held', 'climbUp', 'climbDown'])
const CLICKABLE = new Set<St>(['idle', 'walk', 'air', 'dizzy'])
const GRABBABLE = new Set<St>(['idle', 'walk', 'air', 'dizzy'])
const INTERACTIVE = new Set<St>(['idle', 'walk', 'air', 'held', 'dizzy', 'sleep', 'warn', 'spray'])

const POKE = ['boing !', 'hé !', 'hihi', 'poke poke', 'ça chatouille', '*couic*', 'quoi ?', 'coucou !']
const ANNOYED = ['arrête !', 'hé !!', 'j’ai dit stop']
const ARMED = ['non.', 'J’AI DIT…', 't’es sûr ?']
const CHAT = ['Je t’écoute !', 'Pose-moi ta question !', 'On discute ?']
const PET = ['hihi', 'mmm', 'ronron…', 'encore !', 'juste là']

export function createAutoEngine(els: AutoEls, hooks: AutoHooks): AutoEngine {
  const { canvas, bubble, bubbleText, hit, bulbHit } = els
  const ctx = canvas.getContext('2d')!
  const emb = document.createElement('canvas')

  let S = 4, W = 300, GY = 200, DPR = 1
  let time = 0, last = 0, raf = 0, scanT = 0, shakeAmt = 0
  let dark = false, reduced = false, hold = false, bulbOn = false, alertMsg: string | null = null
  let pres: Presence = 'away', blocked: Span[] = []
  let press: { x: number; y: number; skip: boolean } | null = null
  let hitShown = false, bulbShown = false, bubbleShown = false
  let bulbPos: Pt = { x: 0, y: 0 }
  const P: Particle[] = []
  const M = { x: -99, y: -99, px: -99, py: -99, vx: 0, vy: 0, sp: 0, inside: false, down: false, lastMove: -99 }

  const C = {
    st: 'hidden' as St, t: 0, x: 0, z: 0, vx: 0, vz: 0, bounces: 0,
    goal: null as number | null, run: false, home: 'right' as 'left' | 'right',
    sq: 0, sqv: 0, rot: 0, flipRate: 0, alpha: 1, scaleX: 1, armK: 1, armStart: 0, fallV: 0,
    lookX: 0, lookY: 0, wl: [0, 0], wanderT: 0,
    blink: 0, blinkT: 2, blinkAnim: 0, faceName: 'normal', faceT: 0,
    rL: 0, rR: 0, phase: 0, walk: 0, dir: -1, face: -1, lie: 0, runK: 0, dyS: 0,
    held: false, fx: 0, fy: 0, gx: 0, gy: 0, shake: 0, lastSign: 0, dizzyNext: false, orbitDone: false, thrown: false,
    T: { pv: 5, cr: 1, sr: 0, sx: 1, sy: 1 }, J: {} as Record<string, Pt>, hdL: { x: 0, y: -11 } as Pt,
    legs: { a1: .08, k1: 0, a2: -.08, k2: 0 },
    cape: { tip: [{ x: 0, y: 0, vx: 0, vy: 0 }, { x: 0, y: 0, vx: 0, vy: 0 }], vx: 0, vy: 0, px: undefined as number | undefined, py: 0 },
    gun: 0, kick: 0, shot: false, warnT: -99, sprayT: 0,
    idleT: 2, act: null as string | null, actT: 0, actDur: 0, zT: 0,
    poke: 0, pokeT: -9, petting: 0, petAcc: 0, hover: false,
    sayT: 0, greet: '', arriving: false, exiting: false, lastTouch: 0,
    portal: null as null | { sx: number; dx: number; tx: number; dir: number; k1: number; k2: number; jumped: boolean },
    fly: null as null | { x0: number; z0: number; x1: number; z1: number; dur: number; arc: number; next: 'guide' | 'home'; onArrive?: () => void },
    pointTh: 1.2, guideZ: 0,
  }
  let guideRect: (() => DOMRect | null) | null = null

  const dust = () => (dark ? 'rgba(200,190,230,.6)' : 'rgba(110,90,70,.5)')
  const setPresence = (p: Presence) => { if (p !== pres) { pres = p; hooks.onPresence(p) } }
  function setState(s: St) { C.st = s; C.t = 0; C.act = null; if (s === 'air') C.bounces = 0 }
  const touch = () => { C.lastTouch = time }

  /* ---------- particules ---------- */
  function emit(o: Partial<Particle>) {
    if (reduced && o.type !== 'zzz' && o.type !== 'heart') return
    const p: Particle = { type: 'dot', x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 1, max: 1, col: '#fff', size: 1, ang: 0, ...o }
    p.max = p.life; P.push(p)
  }
  function dustBurst(x: number, n = 5) { for (let i = 0; i < n; i++) emit({ x: x + rnd(-4, 4), y: GY - 1, vx: rnd(-25, 25), vy: rnd(-18, -4), g: 30, life: rnd(.25, .5), col: dust() }) }
  function sparkBurst(x: number, y: number, n: number, cols: string[]) {
    for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(15, 45); emit({ type: 'star', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 40, life: rnd(.4, .8), col: pick(cols) }) }
  }
  const heart = () => emit({ type: 'heart', x: C.x + rnd(-4, 4), y: GY - C.z - 17, vx: rnd(-8, 8), vy: -rnd(14, 26), life: 1.1, col: '#ff6b8b' })

  /* ---------- bulle ---------- */
  function say(text: string, ms = 1900) {
    if (!text) return
    bubbleText.textContent = text
    bubble.dataset.tone = text === alertMsg ? 'error' : ''
    C.sayT = ms / 1000
  }
  function showBubble(on: boolean) { if (on !== bubbleShown) { bubbleShown = on; bubble.style.opacity = on ? '1' : '0' } }
  function placeBubble() {
    const vis = C.sayT > 0 && C.st !== 'hidden' && C.z > -6 && C.alpha > .5
    showBubble(vis)
    if (!vis) return
    const w = bubble.offsetWidth, h = bubble.offsetHeight, vw = innerWidth
    const above = C.lie > .5 ? 7 : (C.st === 'warn' || C.st === 'spray') ? 27 : (bulbOn || alertMsg) ? 24 : 17
    const cx = C.x * S, top = (GY - C.z - above) * S - 6
    const x = clamp(cx, w / 2 + 8, vw - w / 2 - 8)
    let y = Math.max(top, h + 8)
    // En guidage, la bulle ne doit pas cacher l'élément montré : sinon elle passe sous les pieds d'Auto.
    const g = C.st === 'guide' || C.st === 'fly' ? guideRect?.() : null
    const flip = !!g && x - w / 2 < g.right + 6 && x + w / 2 > g.left - 6 && y - h < g.bottom + 6 && y > g.top - 6
    if (flip) y = (GY - C.z) * S + 14 + h
    const arrow = bubble.querySelector<HTMLElement>('i')
    if (arrow) { arrow.style.top = flip ? '-4px' : ''; arrow.style.bottom = flip ? 'auto' : '' }
    bubble.style.setProperty('--tx', clamp(cx - x, -w / 2 + 14, w / 2 - 14) + 'px')
    bubble.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`
  }

  /* ---------- zones à éviter ---------- */
  function scan() {
    const out: Span[] = [], vh = innerHeight, vw = innerWidth
    for (const el of document.querySelectorAll<HTMLElement>(AVOID)) {
      if (el.closest('[data-auto]')) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2 || r.bottom < vh - 28 || r.top > vh) continue
      // Visible au bord bas ? (un panneau recouvert par l'éditeur plein écran ne compte pas)
      const top = document.elementsFromPoint(clamp(r.left + r.width / 2, 1, vw - 1), Math.min(r.bottom, vh) - 4).find((e) => !e.closest('[data-auto]'))
      if (!top || !el.contains(top)) continue
      out.push([r.left / S - 7, r.right / S + 7])
    }
    blocked = mergeSpans(out)
  }
  const segments = () => freeSegments(W, blocked)

  /* ---------- scène ---------- */
  function paintEmblem() {
    const w = Math.max(48, Math.round(4.6 * S * DPR * 2)), h = Math.round(w * .75)
    emb.width = w; emb.height = h
    const e = emb.getContext('2d')!
    e.clearRect(0, 0, w, h); e.textAlign = 'center'; e.textBaseline = 'middle'
    e.font = '800 ' + Math.round(h * .4) + 'px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    e.fillStyle = PAL.t1; e.fillText('Auto', w / 2, h * .3)
    e.fillStyle = PAL.t2; e.fillText('ML', w / 2, h * .74)
  }
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5)
    S = innerWidth < 720 ? 3 : 4
    W = innerWidth / S; GY = innerHeight / S - GROUND_PAD
    canvas.width = Math.round(innerWidth * DPR); canvas.height = Math.round(innerHeight * DPR)
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px'
    C.x = clamp(C.x, 6, W - 6)
    paintEmblem()
    if (C.st !== 'hidden') { scan(); render() }
  }
  function circle(x: number, y: number, r: number) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill() }

  /* ---------- rig (bonhomme + cape) ---------- */
  function xf(p: Pt): Pt {
    const T = C.T, qx = p.x, qy = p.y + T.pv
    return { x: C.x + (qx * T.cr - qy * T.sr) * T.sx, y: (GY - C.z) + (qx * T.sr + qy * T.cr - T.pv) * T.sy }
  }
  function computePose() {
    const t = time, fd = C.face, lie = C.lie, st = C.st
    const sq = C.sq + .012 * Math.sin(t * 2.2)
    C.T = { pv: C.held ? 12 : 5, cr: Math.cos(C.rot), sr: Math.sin(C.rot), sx: (1 + sq * .28) * C.scaleX, sy: 1 - sq * .3 }
    const lean = .2 + .95 * C.walk * (.55 + .45 * C.runK), Lg = C.legs
    const H0 = { x: 0, y: -LEG * 2 }
    const S0 = { x: fd * lean, y: H0.y - 4.4 + (st === 'idle' ? Math.sin(t * 2.2) * .06 : 0) }
    const leg = (a: number, k: number): [Pt, Pt] => {
      const kn = { x: Math.sin(a) * LEG * fd, y: H0.y + Math.cos(a) * LEG }, b = a - k
      return [kn, { x: kn.x + Math.sin(b) * LEG * fd, y: kn.y + Math.cos(b) * LEG }]
    }
    const [kF, fF] = leg(Lg.a1, Lg.k1), [kB, fB] = leg(Lg.a2, Lg.k2)
    const dy = st !== 'air' && st !== 'fly' && !DANGLE.has(st) ? -Math.max(fF.y, fB.y) : 0
    C.dyS += (dy - C.dyS) * .35
    const D = C.dyS
    const sw = Math.sin(C.phase) * .75 * C.walk * (.6 + .4 * C.runK)
    const wave = C.act === 'wave' ? Math.sin(C.actT * 16) * .6 : 0
    // En guidage, le bras avant pointe l'élément (angle calculé depuis l'épaule, voir l'état 'guide').
    const pointing = st === 'guide'
    const thF = pointing ? C.pointTh : -sw + .12 + C.rR * 2.85, thB = sw + .12 + C.rL * 2.85
    const bnd = .35 + .5 * C.walk * (.4 + .6 * C.runK)
    const arm = (th: number, bend: number): [Pt, Pt] => {
      const el = { x: S0.x + Math.sin(th) * ARM * fd, y: S0.y + Math.cos(th) * ARM }
      return [el, { x: el.x + Math.sin(th + bend) * ARM * fd, y: el.y + Math.cos(th + bend) * ARM }]
    }
    const [eF, hF] = arm(thF, pointing ? .04 : bnd + wave), [eB, hB] = arm(thB, bnd)
    const hd = { x: S0.x + fd * .2, y: S0.y - 2.55 }
    const stand: Record<string, Pt> = { H: H0, S: S0, hd, kF, fF, kB, fB, eF, hF, eB, hB }
    const LY: Record<string, Pt> = {
      H: { x: -fd * 1.2, y: -.9 }, S: { x: fd * 3, y: -1.25 }, hd: { x: fd * 5.5, y: -1.95 },
      kF: { x: -fd * 3.2, y: -1.5 }, fF: { x: -fd * 5.3, y: -.5 }, kB: { x: -fd * 2.9, y: -.6 }, fB: { x: -fd * 5.1, y: -.3 },
      eF: { x: fd * 1.8, y: -.4 }, hF: { x: fd * 3.4, y: -.5 }, eB: { x: fd * 1.2, y: -1.3 }, hB: { x: fd * 2.6, y: -1 },
    }
    const L: Record<string, Pt> = {}
    for (const k in stand) L[k] = { x: mix(stand[k].x, LY[k].x, lie), y: mix(stand[k].y + D, LY[k].y, lie) }
    const dv = { x: L.S.x - L.hd.x, y: L.S.y - L.hd.y }, dl = Math.hypot(dv.x, dv.y) || 1
    L.nk = { x: L.hd.x + dv.x / dl * HEADR, y: L.hd.y + dv.y / dl * HEADR }
    L.T1 = { x: L.S.x + fd * .25, y: L.S.y }
    L.T2 = { x: L.S.x - fd * .45, y: L.S.y + .9 }
    C.hdL = L.hd
    const J: Record<string, Pt> = {}
    for (const k in L) J[k] = xf(L[k])
    C.J = J
  }
  function initCape() {
    const J = C.J, cp = C.cape, fd = C.face
    for (let i = 0; i < 2; i++) { const T = i ? J.T2 : J.T1, tip = cp.tip[i]; tip.x = T.x + HANG[i].x * fd; tip.y = T.y + HANG[i].y; tip.vx = 0; tip.vy = 0 }
    cp.px = J.T1.x; cp.py = J.T1.y; cp.vx = 0; cp.vy = 0
  }
  function updateCape(dt: number) {
    const J = C.J, cp = C.cape, fd = C.face, lie = C.lie
    const ivx = (J.T1.x - cp.px!) / dt, ivy = (J.T1.y - cp.py) / dt
    cp.vx += (ivx - cp.vx) * ease(dt, 10); cp.vy += (ivy - cp.vy) * ease(dt, 10)
    cp.px = J.T1.x; cp.py = J.T1.y
    const w = clamp(Math.abs(cp.vx) / 70, 0, 1)
    const sd = Math.abs(cp.vx) > 20 ? -Math.sign(cp.vx) : -fd
    const lift = clamp(cp.vy * .05, -3, 5)
    for (let i = 0; i < 2; i++) {
      const T = i ? J.T2 : J.T1, tip = cp.tip[i], ph = i * 1.7
      let tx = mix(HANG[i].x * fd, STREAM[i].x * sd, w), ty = mix(HANG[i].y, STREAM[i].y, w) - lift
      tx = mix(tx, LIE[i].x * fd, lie); ty = mix(ty, LIE[i].y, lie)
      tx += Math.sin(time * 13 + ph) * .35 * w
      ty += Math.sin(time * 10 + ph * 2) * .8 * w + Math.sin(time * 1.6 + ph) * .2
      tip.vx += ((T.x + tx - tip.x) * 70 - tip.vx * 9) * dt
      tip.vy += ((T.y + ty - tip.y) * 70 - tip.vy * 9) * dt
      tip.x += tip.vx * dt; tip.y += tip.vy * dt
      const dx = tip.x - T.x, dy = tip.y - T.y, d = Math.hypot(dx, dy)
      if (d > 9) { tip.x = T.x + dx / d * 9; tip.y = T.y + dy / d * 9 }
      // La cape ne passe pas sous le sol… sauf quand Auto grimpe (tout ce qui est sous le bord est hors écran).
      if (C.z > -1 && tip.y > GY + .2) { tip.y = GY + .2; if (tip.vy > 0) tip.vy = 0 }
    }
  }
  function updateHero(dt: number) {
    if (C.st === 'idle' && M.inside && time - M.lastMove < 8 && Math.abs(M.x - C.x) > 5) C.dir = Math.sign(M.x - C.x)
    C.face += (C.dir - C.face) * ease(dt, 14)
    C.lie += ((C.st === 'sleep' ? 1 : 0) - C.lie) * ease(dt, 5)
    C.runK += ((C.st === 'walk' && C.run ? 1 : 0) - C.runK) * ease(dt, 6)
    const walk = C.walk, amp = .55 + .5 * C.runK, fl = .7 + .6 * C.runK, ph = C.phase
    let a1: number, k1: number, a2: number, k2: number
    if (DANGLE.has(C.st)) {
      a1 = Math.sin(time * 6) * .3 + .05; k1 = .35 + .2 * Math.sin(time * 6 + 1)
      a2 = Math.sin(time * 6 + 2.2) * .3 - .05; k2 = .35 + .2 * Math.sin(time * 6 + 3)
    } else if (C.st === 'air') { a1 = .75; k1 = 1.1; a2 = -.3; k2 = .5 }
    else if (C.st === 'fly') { a1 = -.2; k1 = .15; a2 = -.5; k2 = .35 } // jambes tendues vers l'arrière, façon super-héros
    else {
      a1 = Math.sin(ph) * amp * walk + .08 * (1 - walk); k1 = Math.max(0, Math.cos(ph)) * fl * walk
      a2 = Math.sin(ph + Math.PI) * amp * walk - .08 * (1 - walk); k2 = Math.max(0, Math.cos(ph + Math.PI)) * fl * walk
    }
    const e = ease(dt, 20), L = C.legs
    L.a1 += (a1 - L.a1) * e; L.k1 += (k1 - L.k1) * e; L.a2 += (a2 - L.a2) * e; L.k2 += (k2 - L.k2) * e
    computePose()
    if (C.cape.px === undefined) initCape()
    updateCape(dt)
  }

  /* ---------- dessin ---------- */
  function drawCape() {
    const J = C.J, T1 = J.T1, T2 = J.T2, B1 = C.cape.tip[0], B2 = C.cape.tip[1]
    const mt = { x: (T1.x + T2.x) / 2, y: (T1.y + T2.y) / 2 }, mb = { x: (B1.x + B2.x) / 2, y: (B1.y + B2.y) / 2 }
    const ax = mb.x - mt.x, ay = mb.y - mt.y, al = Math.hypot(ax, ay) || 1, nx = -ay / al, ny = ax / al
    ctx.beginPath(); ctx.moveTo(T1.x, T1.y)
    ctx.quadraticCurveTo((T1.x + B1.x) / 2 + nx * .5, (T1.y + B1.y) / 2 + ny * .5, B1.x, B1.y)
    ctx.quadraticCurveTo((B1.x + B2.x) / 2 + ax / al * 1.1, (B1.y + B2.y) / 2 + ay / al * 1.1, B2.x, B2.y)
    ctx.quadraticCurveTo((T2.x + B2.x) / 2 + nx * .5, (T2.y + B2.y) / 2 + ny * .5, T2.x, T2.y)
    ctx.closePath(); ctx.fillStyle = PAL.c; ctx.fill()
    ctx.save(); ctx.clip()
    ctx.translate((T1.x + T2.x + B1.x + B2.x) / 4, (T1.y + T2.y + B1.y + B2.y) / 4)
    ctx.rotate(clamp((Math.atan2(ay, ax) - Math.PI / 2) * .55, -.8, .8))
    ctx.drawImage(emb, -1.7, -1.3, 3.4, 2.6)
    ctx.restore()
    ctx.lineJoin = 'round'; ctx.lineWidth = .45; ctx.strokeStyle = PAL.dk; ctx.stroke()
  }
  function faceOf(): string {
    if (C.st === 'sleep') return 'sleep'
    if (C.st === 'dizzy' || (C.st === 'held' && C.shake > 6)) return 'dizzy'
    if (C.st === 'held') return 'scared'
    if (C.st === 'warn') return 'annoyed'
    if (C.st === 'spray') return C.t > .6 && C.t < 2.5 ? 'yawn' : 'annoyed'
    if (C.faceT > 0) return C.faceName
    if (alertMsg) return 'scared'
    if (C.st === 'guide' || C.st === 'fly') return 'happy'
    if (C.petting > 0) return 'happy'
    if (C.act === 'yawn') return 'yawn'
    return 'normal'
  }
  function drawFace() {
    const T = C.T, ks = (T.sx + T.sy) / 2, fdd = C.face, face = faceOf()
    const F = (ox: number, oy: number) => xf({ x: C.hdL.x + ox, y: C.hdL.y + oy })
    const sep = .8 * (1 - Math.abs(fdd) * .35), base = fdd * .8
    const lx = clamp(C.lookX * .5, -.6, .6), ly = clamp(C.lookY * .35, -.4, .4)
    const e1 = clamp(base - sep + lx, -1.45, 1.45), e2 = clamp(base + sep + lx, -1.45, 1.45), ey = -.25 + ly
    const mx = base + lx * .6, my = .8 + ly * .4
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = .26 * ks; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const dot = (ox: number, oy: number, rr: number) => { const p = F(ox, oy); ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.fill() }
    const line = (x1: number, y1: number, x2: number, y2: number) => { const a = F(x1, y1), b = F(x2, y2); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
    const arc = (ox: number, oy: number, rr: number, a0: number, a1: number) => { const p = F(ox, oy); ctx.beginPath(); ctx.arc(p.x, p.y, rr * ks, a0, a1); ctx.stroke() }
    if (face === 'happy') { ctx.fillStyle = 'rgba(255,110,140,.4)'; dot(e1, .55, .42 * ks); dot(e2, .55, .42 * ks); ctx.fillStyle = INK }
    switch (face) {
      case 'happy': arc(e1, ey + .2, .38, Math.PI, 0); arc(e2, ey + .2, .38, Math.PI, 0); break
      case 'sleep': case 'yawn': arc(e1, ey - .1, .38, 0, Math.PI); arc(e2, ey - .1, .38, 0, Math.PI); break
      case 'scared':
        for (const ex of [e1, e2]) {
          const p = F(ex, ey), q = F(ex + lx * .3, ey + ly * .3)
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, .55 * ks, 0, TAU); ctx.fill(); ctx.stroke()
          ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(q.x, q.y, .2 * ks, 0, TAU); ctx.fill()
        }
        break
      case 'dizzy': for (const ex of [e1, e2]) { line(ex - .28, ey - .28, ex + .28, ey + .28); line(ex - .28, ey + .28, ex + .28, ey - .28) } break
      default:
        if (C.blink > .5) { line(e1 - .3, ey, e1 + .3, ey); line(e2 - .3, ey, e2 + .3, ey) } else { dot(e1, ey, .3 * ks); dot(e2, ey, .3 * ks) }
        if (face === 'annoyed') { line(e1 - .45, ey - .85, e1 + .4, ey - .5); line(e2 - .4, ey - .5, e2 + .45, ey - .85) }
    }
    switch (face) {
      case 'happy': arc(mx, my - .35, .6, .15 * Math.PI, .85 * Math.PI); break
      case 'scared': arc(mx, my, .38, 0, TAU); break
      case 'yawn': { const p = F(mx, my + .1); ctx.beginPath(); ctx.ellipse(p.x, p.y, .42 * ks, .62 * ks, 0, 0, TAU); ctx.fill(); break }
      case 'dizzy': line(mx - .5, my, mx - .17, my + .2); line(mx - .17, my + .2, mx + .17, my - .1); line(mx + .17, my - .1, mx + .5, my + .1); break
      case 'annoyed': line(mx - .45, my + .1, mx + .45, my + .1); break
      case 'sleep': line(mx - .3, my, mx + .3, my); break
      default: arc(mx, my - .5, .65, .22 * Math.PI, .78 * Math.PI)
    }
    if (face === 'scared') { ctx.fillStyle = '#7cc8ff'; dot(1.7, -1.3, .35 * ks) }
  }
  function drawGun() {
    if (C.gun < .04) return
    const J = C.J, sd = C.dir < 0 ? -1 : 1
    const a = Math.atan2(J.hF.y - J.eF.y, J.hF.x - J.eF.x) - sd * C.kick * .35
    const ox = J.hF.x - Math.cos(a) * C.kick * 1.1, oy = J.hF.y - Math.sin(a) * C.kick * 1.1
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(a); ctx.scale(C.gun, C.gun * (Math.cos(a) < 0 ? -1 : 1))
    ctx.lineJoin = 'round'
    const halo = () => { if (dark) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = .3; ctx.stroke() } }
    const box = (x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle = col; ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); halo() }
    ctx.fillStyle = '#34343c'; ctx.beginPath(); ctx.moveTo(.5, .4); ctx.lineTo(1.9, .4); ctx.quadraticCurveTo(2.5, 1.8, 1.9, 2.9); ctx.lineTo(1, 2.9); ctx.quadraticCurveTo(1.4, 1.8, .5, .4); ctx.fill(); halo()
    ctx.fillStyle = '#8a5530'; ctx.beginPath(); ctx.moveTo(-1.4, -.5); ctx.lineTo(-4.2, -.1); ctx.lineTo(-4.2, 1.1); ctx.lineTo(-1.4, .6); ctx.closePath(); ctx.fill(); halo()
    box(-.5, .4, .9, 1.7, '#8a5530'); box(-1.5, -.6, 3.9, 1.2, '#2c2c33'); box(2.4, -.5, 2.1, 1, '#9a6035')
    box(4.5, -.18, 2.2, .36, '#2c2c33'); box(2.4, -.85, 2.4, .3, '#2c2c33'); box(6.2, -.6, .3, .5, '#2c2c33')
    ctx.restore()
  }
  function drawHero() {
    drawCape()
    const J = C.J, T = C.T, ks = (T.sx + T.sy) / 2, LW = .58 * ks
    const segs = [[J.S, J.eB, J.hB], [J.H, J.kB, J.fB], [J.H, J.S], [J.S, J.nk], [J.H, J.kF, J.fF], [J.S, J.eF, J.hF]]
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const pass = (col: string, w: number) => {
      ctx.strokeStyle = col; ctx.lineWidth = w
      for (const s of segs) { ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y); ctx.stroke() }
    }
    if (dark) pass('rgba(255,255,255,.85)', LW + 1.1)
    pass(INK, LW)
    drawGun()
    ctx.beginPath(); ctx.arc(J.hd.x, J.hd.y, HEADR * ks, 0, TAU)
    ctx.fillStyle = '#fff'; ctx.fill()
    if (dark) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = LW + 1.1; ctx.stroke() }
    ctx.strokeStyle = INK; ctx.lineWidth = LW * .9; ctx.stroke()
    drawFace()
  }
  function drawBulb(x: number, y: number) {
    const pulse = reduced ? .6 : .5 + .5 * Math.sin(time * 4)
    const g = ctx.createRadialGradient(x, y, 0, x, y, 5)
    g.addColorStop(0, `rgba(255,224,102,${.5 + .3 * pulse})`); g.addColorStop(1, 'rgba(255,224,102,0)')
    ctx.fillStyle = g; circle(x, y, 5)
    ctx.fillStyle = '#ffe066'; circle(x, y - .2, 1.6)
    ctx.lineWidth = .22; ctx.strokeStyle = '#b8860b'; ctx.beginPath(); ctx.arc(x, y - .2, 1.6, 0, TAU); ctx.stroke()
    ctx.fillStyle = '#9ca3af'; ctx.fillRect(x - .7, y + 1.2, 1.4, 1.1)
    ctx.strokeStyle = '#6b7280'; ctx.beginPath(); ctx.moveTo(x - .7, y + 1.6); ctx.lineTo(x + .7, y + 1.6); ctx.moveTo(x - .7, y + 2); ctx.lineTo(x + .7, y + 2); ctx.stroke()
    ctx.strokeStyle = '#f2b01e'; ctx.lineWidth = .28
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * .55, r0 = 2.3, r1 = 2.9 + pulse * .5
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y - .2 + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y - .2 + Math.sin(a) * r1); ctx.stroke()
    }
  }
  function drawAlert(x: number, y: number) {
    const k = reduced ? 1 : 1 + .08 * Math.sin(time * 9)
    ctx.fillStyle = 'rgba(239,68,68,.25)'; circle(x, y, 3 * k)
    ctx.fillStyle = '#ef4444'; circle(x, y, 1.9 * k)
    ctx.fillStyle = '#fff'; ctx.fillRect(x - .26, y - 1.25, .52, 1.55); circle(x, y + .9, .3)
  }
  function drawPortal(x: number, k: number) {
    if (k <= .01) return
    const ry = 8.5 * k, cy = GY - 8
    ctx.save(); ctx.translate(x, cy); ctx.scale(.45, 1)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry * 1.15)
    g.addColorStop(0, 'rgba(12,6,34,.95)'); g.addColorStop(.65, 'rgba(76,29,149,.9)'); g.addColorStop(1, 'rgba(139,92,246,0)')
    ctx.fillStyle = g; circle(0, 0, ry * 1.15)
    ctx.lineWidth = .7; ctx.strokeStyle = '#c4b5fd'; ctx.lineCap = 'round'
    for (let i = 0; i < 3; i++) { const a = time * 5 + i * TAU / 3; ctx.beginPath(); ctx.arc(0, 0, ry * .9, a, a + 1.4); ctx.stroke() }
    ctx.restore()
  }
  function heartPath(x: number, y: number, s: number) {
    ctx.beginPath(); ctx.moveTo(x, y + s * .9)
    ctx.bezierCurveTo(x - s * 1.6, y - s * .1, x - s * .8, y - s * 1.2, x, y - s * .4)
    ctx.bezierCurveTo(x + s * .8, y - s * 1.2, x + s * 1.6, y - s * .1, x, y + s * .9)
    ctx.closePath()
  }
  function starPath(x: number, y: number, s: number) {
    ctx.beginPath(); ctx.moveTo(x, y - s)
    ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s)
    ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s)
    ctx.closePath()
  }
  function drawParticles() {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const p of P) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.6, 0, 1)
      ctx.fillStyle = p.col; ctx.strokeStyle = p.col
      switch (p.type) {
        case 'heart': heartPath(p.x, p.y, 1); ctx.fill(); break
        case 'star': case 'orbit': starPath(p.x, p.y, 1.1); ctx.fill(); break
        case 'zzz': {
          const z = .9 * p.size; ctx.lineWidth = .35
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + z, p.y); ctx.lineTo(p.x, p.y + z); ctx.lineTo(p.x + z, p.y + z); ctx.stroke()
          break
        }
        case 'flash': { const k = p.life / p.max; ctx.fillStyle = '#ffb347'; circle(p.x, p.y, 1.2 + 1.6 * k); ctx.fillStyle = p.col; starPath(p.x, p.y, 1.6 + 3.4 * k); ctx.fill(); break }
        case 'tracer': ctx.lineWidth = .35; ctx.beginPath(); ctx.moveTo(p.x - p.vx * .02, p.y - p.vy * .02); ctx.lineTo(p.x, p.y); ctx.stroke(); break
        default: circle(p.x, p.y, .3 * p.size + .1)
      }
    }
    ctx.globalAlpha = 1
  }
  function placeHit(show: boolean) {
    if (show !== hitShown) { hitShown = show; hit.style.display = show ? 'block' : 'none' }
    if (show) {
      const lying = C.lie > .5, w = lying ? 16 : 12, h = lying ? 7 : 17.5
      hit.style.width = w * S + 'px'; hit.style.height = h * S + 'px'
      hit.style.transform = `translate(${(C.x - w / 2) * S}px,${(GY - C.z - h + 1) * S}px)`
    }
    const showB = show && bulbOn
    if (showB !== bulbShown) { bulbShown = showB; bulbHit.style.display = showB ? 'block' : 'none' }
    if (showB) { const s = 8 * S; bulbHit.style.width = s + 'px'; bulbHit.style.height = s + 'px'; bulbHit.style.transform = `translate(${bulbPos.x * S - s / 2}px,${bulbPos.y * S - s / 2}px)` }
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (C.st === 'hidden') return
    const sk = shakeAmt > 0 && !reduced ? shakeAmt * S * DPR : 0
    ctx.setTransform(S * DPR, 0, 0, S * DPR, sk ? rnd(-sk, sk) : 0, sk ? rnd(-sk, sk) : 0)
    if (C.portal) { drawPortal(C.portal.sx, C.portal.k1); drawPortal(C.portal.dx, C.portal.k2) }
    ctx.globalAlpha = C.alpha
    // Sous le sol (escalade), rien n'est dessiné : le sol est relevé de GROUND_PAD au-dessus du bord.
    const clip = C.z < 0
    if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(-5, -5, W + 10, GY + 5); ctx.clip() }
    drawHero()
    if (clip) ctx.restore()
    const hx = C.J.hd.x, hy = C.J.hd.y - 5.6 + (reduced ? 0 : Math.sin(time * 3) * .35)
    if (alertMsg) drawAlert(bulbOn ? hx - 2.6 : hx, hy)
    bulbPos = { x: alertMsg ? hx + 2.6 : hx, y: hy }
    if (bulbOn) drawBulb(bulbPos.x, bulbPos.y)
    ctx.globalAlpha = 1
    drawParticles()
    placeBubble()
    placeHit(INTERACTIVE.has(C.st) && !C.exiting && C.alpha > .4 && C.z > -6)
  }

  /* ---------- comportements ---------- */
  function startAct(name: string, dur: number) { C.act = name; C.actT = 0; C.actDur = dur }
  function setFace(name: string, dur: number) { C.faceName = name; C.faceT = dur }
  function jump(vz: number, vx = 0) { setState('air'); C.vz = vz; C.vx = vx; C.sq = -.45; C.walk = 0; dustBurst(C.x, 4) }
  const hop = (vz: number) => { if (reduced) C.sq = .3; else jump(vz) }
  function arrive() {
    setState('idle'); C.idleT = rnd(1.5, 3); touch(); setPresence('present')
    if (C.greet) { startAct('wave', 2.2); say(C.greet, 2600); C.greet = '' }
  }
  function land() {
    C.z = 0; C.vz = 0; C.vx = 0; C.rot = 0; C.flipRate = 0
    C.sq = Math.max(C.sq, .5); dustBurst(C.x, 6)
    if (C.thrown) { C.thrown = false; C.home = C.x < W / 2 ? 'left' : 'right' }
    if (C.dizzyNext) { C.dizzyNext = false; setState('dizzy'); say('beurk…'); return }
    if (C.arriving) { C.arriving = false; arrive(); return }
    setState('idle'); C.idleT = rnd(1, 2.5)
  }
  function think() {
    C.idleT = rnd(3, 7)
    const r = Math.random()
    if (r < .3) startAct('look', rnd(1.5, 3))
    else if (r < .45) startAct('wave', 1.6)
    else if (r < .6) startAct('yawn', 1.8)
    else if (r < .75) startAct('shimmy', 1.6)
    else if (r < .85 && !reduced) jump(85)
    else startAct('look', 2)
  }
  function nap() { if (C.st !== 'idle') return; setState('sleep'); C.zT = 0; say('zzz…', 1500) }
  function wake(msg: string) {
    touch()
    if (reduced) setState('idle'); else { setState('air'); C.vz = 85; C.sq = -.3 }
    setFace('scared', .7); if (msg) say(msg, 1100)
  }
  /** Rejoint le coin de repos : à pied si le chemin est libre, sinon par un portail. */
  function navigate(): boolean {
    const segs = segments()
    if (!segs.length) return false
    const target = homeX(segs, C.home), inside = isBlocked(C.x, blocked)
    if (!inside && Math.abs(target - C.x) < 2) return false
    if (inside || crossesBlocked(C.x, target, blocked)) startPortal(target)
    else { C.goal = target; C.run = Math.abs(target - C.x) > 60; setState('walk') }
    return true
  }
  function startPortal(target: number) {
    const dir = Math.sign(target - C.x) || 1
    C.portal = { sx: clamp(C.x + dir * 5, 6, W - 6), dx: clamp(target - dir * 5, 6, W - 6), tx: target, dir, k1: 0, k2: 0, jumped: false }
    C.dir = dir; C.goal = null; setState('portal')
    if (!reduced && Math.random() < .5) say(pick(['Raccourci !', 'Par ici !']), 1100)
  }
  function click() {
    touch()
    if (C.st === 'sleep') { wake('hein ?!'); return }
    if (!CLICKABLE.has(C.st) || C.exiting) return
    if (time - C.pokeT > 3) C.poke = 0
    C.poke++; C.pokeT = time
    const armed = time - C.warnT < 30
    if (C.poke === 1 && !armed) { hooks.onChat(); say(pick(CHAT), 1600); if (C.st === 'idle' || C.st === 'walk') hop(90); return }
    if (armed && C.poke >= 3) { C.poke = 0; C.warnT = -99; startShooting('spray'); return }
    if (!armed && C.poke >= 7) { C.poke = 0; startShooting('warn'); return }
    if (C.poke >= 5 || armed) { setFace('annoyed', 1.4); say(pick(armed ? ARMED : ANNOYED), 1200); hop(80) }
    else { say(pick(POKE), 1000); hop(110) }
  }
  function startShooting(kind: 'warn' | 'spray') {
    C.goal = null; C.z = 0; C.vz = 0; C.rot = 0; C.flipRate = 0
    setState(kind); C.kick = 0; C.shot = false; C.sprayT = 0
    if (kind === 'warn') C.warnT = time
    if (M.inside && Math.abs(M.x - C.x) > 4) C.dir = Math.sign(M.x - C.x)
    say(kind === 'warn' ? pick(['ça suffit.', 'je t’avais prévenu.', 'dernier avertissement…']) : pick(['C’EST BON !', 'ASSEZ !!', 'TU EN VEUX ENCORE ?']), kind === 'warn' ? 1300 : 1000)
  }
  function fireShot(auto: boolean) {
    const J = C.J, sd = C.dir < 0 ? -1 : 1
    const a0 = Math.atan2(J.hF.y - J.eF.y, J.hF.x - J.eF.x)
    const mx = J.hF.x + Math.cos(a0) * 6.7, my = J.hF.y + Math.sin(a0) * 6.7
    const a = auto ? a0 + rnd(-.1, .1) : a0
    C.kick = auto ? .75 : 1; shakeAmt = auto ? .55 : 1; C.sq = Math.max(C.sq, auto ? .2 : .35)
    emit({ type: 'flash', x: mx, y: my, life: auto ? .06 : .09, col: '#fff1b0' })
    emit({ type: 'tracer', x: mx, y: my, vx: Math.cos(a) * 460, vy: Math.sin(a) * 460, life: .5, col: '#ffe9a0' })
    for (let i = 0, n = auto ? 1 : 6; i < n; i++) emit({ x: mx + rnd(-1, 1), y: my + rnd(-1, 1), vx: Math.cos(a) * rnd(6, 22) + rnd(-6, 6), vy: Math.sin(a) * rnd(6, 22) - rnd(2, 10), g: -4, life: rnd(.5, 1), col: dust(), size: rnd(2, 3.5) })
    emit({ x: J.hF.x, y: J.hF.y, vx: -sd * rnd(15, 35), vy: -rnd(30, 60), g: 240, life: 1.4, col: '#e0b252', size: 1.2, gy: GY })
    if (!auto) say('PAN !', 800)
  }
  function startDrag() {
    C.goal = null; setState('held'); C.held = true; touch()
    C.fx = C.x; C.fy = GY - C.z; C.gx = C.x - M.x; C.gy = (GY - C.z) - M.y
    C.shake = 0; C.lastSign = 0; C.flipRate = 0; C.orbitDone = false
    say(pick(['repose-moi !', 'ouah !', 'hé !', 'je vole !']), 1400)
  }
  function release() {
    C.held = false; touch()
    const vx = clamp(M.vx * .25, -140, 140), vz = clamp(-M.vy * .45, -200, 220)
    if (C.shake > 6) C.dizzyNext = true
    setState('air'); C.vx = vx; C.vz = vz; C.sq = -.2; C.thrown = true
    say(C.dizzyNext ? 'oooh…' : pick(['youpiii !', 'ouah !', 'wiii']), 1200)
  }
  function hide() {
    C.st = 'hidden'; C.portal = null; C.fly = null; guideRect = null; C.held = false; C.exiting = false; C.arriving = false; press = null
    P.length = 0; C.sayT = 0
    showBubble(false); placeHit(false)
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height)
    setPresence('away')
  }

  /* ---------- mise à jour ---------- */
  function updatePose(dt: number) {
    let tl = 0, tr = 0
    if (C.act === 'wave') tr = .75 + .25 * Math.sin(C.actT * 16)
    else if (C.act === 'shimmy') { tl = .45 + .45 * Math.sin(C.actT * 11); tr = .45 + .45 * Math.sin(C.actT * 11 + Math.PI) }
    else if (C.act === 'yawn') tl = tr = .55 * Math.min(1, C.actT * 3)
    if (C.hover && C.st === 'idle') { tl = Math.max(tl, .3); tr = Math.max(tr, .3) }
    if (C.petting > 0) { tl = .5 + .5 * Math.sin(time * 16); tr = .5 + .5 * Math.sin(time * 16 + Math.PI) }
    switch (C.st) {
      case 'air': tl = tr = C.vz > 0 ? .95 : .5; break
      case 'held': tl = .6 + .4 * Math.sin(time * 13); tr = .6 + .4 * Math.sin(time * 13 + 2); break
      case 'dizzy': tl = .5 + .5 * Math.sin(time * 7); tr = .5 + .5 * Math.sin(time * 7 + 3); break
      case 'sleep': tl = tr = 0; break
      case 'warn': case 'spray': tl = .7; tr = .76; break
      case 'climbUp': case 'climbDown': tl = tr = C.armK; break
      case 'walk': case 'portal': tl = .25 + .25 * Math.sin(C.phase); tr = .25 + .25 * Math.sin(C.phase + Math.PI); break
      case 'fly': tl = .15; tr = .92; break // poing en avant
      case 'guide': tl = .08; break
    }
    C.rL += (tl - C.rL) * ease(dt, 16); C.rR += (tr - C.rR) * ease(dt, 16)

    let tx = 0, ty = 0
    if (C.st === 'climbUp' && C.t > .45 && C.t < .95) { tx = Math.sin((C.t - .45) * 9); ty = -.3 }
    else if (C.st === 'guide') { tx = C.face; ty = clamp(Math.cos(C.pointTh) * 1.2, -1, 1) }
    else if (C.st === 'fly') { tx = C.dir; ty = 0 }
    else if (C.act === 'look' && bulbOn) { tx = C.face * .3; ty = -1 }
    else if (C.st === 'walk' || C.st === 'portal') { tx = C.dir * .9; ty = .1 }
    else if (M.inside && time - M.lastMove < 8) { tx = clamp((M.x - C.x) / 25, -1, 1); ty = clamp((M.y - (GY - C.z - 10)) / 20, -1, 1) }
    else {
      C.wanderT -= dt
      if (C.wanderT <= 0) { C.wanderT = rnd(.8, 2); C.wl = [rnd(-1, 1), rnd(-.6, .8)] }
      tx = C.wl[0]; ty = C.wl[1]
    }
    C.lookX += (tx - C.lookX) * ease(dt, 12); C.lookY += (ty - C.lookY) * ease(dt, 12)

    C.blinkT -= dt
    if (C.blinkT <= 0) { C.blinkAnim = .18; C.blinkT = rnd(1.8, 4.5) }
    if (C.blinkAnim > 0) { C.blinkAnim -= dt; const q = 1 - Math.max(0, C.blinkAnim) / .18; C.blink = 1 - Math.abs(2 * q - 1) } else C.blink = 0
  }

  function update(dt: number) {
    const ivx = (M.x - M.px) / dt, ivy = (M.y - M.py) / dt
    M.vx += (ivx - M.vx) * .35; M.vy += (ivy - M.vy) * .35; M.sp = Math.hypot(M.vx, M.vy)
    const moved = Math.hypot(M.x - M.px, M.y - M.py)

    C.faceT -= dt; C.sayT -= dt; C.petting -= dt
    if (C.sayT <= 0 && alertMsg) say(alertMsg, Infinity) // l'erreur reste affichée tant qu'elle n'est pas réglée
    C.shake = Math.max(0, C.shake - dt * 1.2)
    shakeAmt = Math.max(0, shakeAmt - dt * 8); C.kick = Math.max(0, C.kick - dt * 5)
    C.gun += ((((C.st === 'warn' && C.t < 1.9) || (C.st === 'spray' && C.t < 3)) ? 1 : 0) - C.gun) * ease(dt, 14)
    if (hold || alertMsg) touch()
    scanT -= dt; if (scanT <= 0) { scanT = .5; scan() }

    if (press && !press.skip && !C.held && GRABBABLE.has(C.st) && !C.exiting && Math.hypot(M.x - press.x, M.y - press.y) > 3) startDrag()

    if (C.hover && moved > 2 && C.st === 'sleep') wake('hein ?')
    else if (C.hover && moved > 0 && !M.down && (C.st === 'idle' || C.st === 'walk') && M.sp <= 260) {
      // Caresse : frotter lentement le curseur sur Auto.
      C.petting = .4; C.petAcc += moved; touch()
      if (C.st === 'walk') { C.goal = null; setState('idle') }
      if (C.petAcc > 16) { C.petAcc = 0; heart(); if (Math.random() < .12) say(pick(PET), 1100) }
    }

    switch (C.st) {
      case 'climbUp': {
        C.t += dt; const t = C.t
        if (t < .45) { C.z = mix(-17, -12.6, smooth(t / .45)); C.armK = 1 }
        else if (t < .95) C.z = -12.6 + Math.sin((t - .45) * 10) * .15
        else if (t < 1.45) { const k = smooth((t - .95) / .5); C.z = mix(-12.6, -4.5, k); C.armK = mix(1, .25, k) }
        else { setState('air'); C.vz = 78; C.vx = 0; C.bounces = 1; C.arriving = true }
        break
      }
      case 'climbDown': {
        C.t += dt; const t = C.t
        if (t < .3) { const k = smooth(t / .3); C.z = mix(0, -4.5, k); C.armK = mix(C.armStart, .25, k) }
        else if (t < .9) { const k = smooth((t - .3) / .6); C.z = mix(-4.5, -12.6, k); C.armK = mix(.25, 1, k) }
        else if (t >= 1.2) { C.fallV += G * dt; C.z -= C.fallV * dt; if (C.z < -20) { hide(); return } }
        break
      }
      case 'fly': {
        const f = C.fly!; C.t += dt
        const k = clamp(C.t / f.dur, 0, 1), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        C.x = mix(f.x0, f.x1, e); C.z = mix(f.z0, f.z1, e) + Math.sin(Math.PI * k) * f.arc
        C.rot = C.dir * .4 * Math.sin(Math.PI * k) // penché dans le sens du vol ; la cape suit par sa physique
        if (Math.random() < .35) emit({ type: 'star', x: C.x - C.dir * 3, y: GY - C.z - 6, vx: -C.dir * rnd(10, 25), vy: rnd(-8, 8), life: .4, col: '#c4b5fd' })
        if (k >= 1) {
          C.rot = 0; C.fly = null; C.sq = .45
          if (f.next === 'guide') { C.guideZ = f.z1; setState('guide'); f.onArrive?.() }
          else { C.z = 0; dustBurst(C.x, 5); setState('idle'); C.idleT = rnd(1.5, 3); touch() }
        }
        break
      }
      case 'guide': {
        C.t += dt; C.walk += (0 - C.walk) * ease(dt, 10)
        C.z = C.guideZ + (reduced ? 0 : Math.sin(C.t * 2.4) * .35) // léger flottement
        const r = guideRect?.()
        if (r && r.width > 0) {
          const cx = (r.left + r.right) / 2 / S, cy = (r.top + r.bottom) / 2 / S
          if (Math.abs(cx - C.x) > 1) C.dir = Math.sign(cx - C.x)
          const sx = C.x + C.face * .2, sy = GY - C.z - 9 // épaule
          C.pointTh += (Math.atan2(Math.abs(cx - sx), cy - sy) - C.pointTh) * ease(dt, 14)
        }
        break
      }
      case 'fadeIn': C.t += dt; C.alpha = clamp(C.t / .35, 0, 1); if (C.t >= .35) { C.alpha = 1; arrive() } break
      case 'fadeOut': C.t += dt; C.alpha = 1 - clamp(C.t / .35, 0, 1); if (C.t >= .35) { hide(); return } break
      case 'idle': {
        C.walk += (0 - C.walk) * ease(dt, 10)
        if (C.petting > 0) break
        if (isBlocked(C.x, blocked) && navigate()) break
        if (C.act) { C.actT += dt; if (C.actT >= C.actDur) C.act = null }
        else if (!navigate()) { C.idleT -= dt; if (C.idleT <= 0) think() }
        if (C.st === 'idle' && !C.act && !hold && !alertMsg && time - C.lastTouch > IDLE_SLEEP) nap()
        break
      }
      case 'walk': {
        if (C.goal == null) { setState('idle'); break }
        const dx = C.goal - C.x
        if (Math.abs(dx) <= 1.5) { C.goal = null; setState('idle'); C.idleT = rnd(1, 2); break }
        if (crossesBlocked(C.x, C.goal, blocked)) { startPortal(C.goal); break }
        const sp = C.run ? 90 : 42
        C.x += Math.sign(dx) * Math.min(Math.abs(dx), sp * dt)
        C.dir = Math.sign(dx); C.phase += sp * dt * .32; C.walk += (1 - C.walk) * ease(dt, 12)
        break
      }
      case 'portal': {
        const p = C.portal!; C.t += dt; const t = C.t
        if (reduced) {
          C.alpha = t < .3 ? 1 - t / .3 : t < .35 ? 0 : clamp((t - .35) / .3, 0, 1)
          if (t >= .3 && !p.jumped) { p.jumped = true; C.x = p.tx }
          if (t >= .65) { C.portal = null; C.alpha = 1; setState('idle'); C.idleT = rnd(1, 2) }
          break
        }
        p.k1 = t < .3 ? t / .3 : t < .8 ? 1 : Math.max(0, 1 - (t - .8) / .25)
        p.k2 = t < .75 ? 0 : t < 1.05 ? (t - .75) / .3 : t < 1.5 ? 1 : Math.max(0, 1 - (t - 1.5) / .25)
        const stepTo = (x: number) => { const d = x - C.x; C.x += Math.sign(d) * Math.min(Math.abs(d), 40 * dt); C.phase += 40 * dt * .32; C.walk += (1 - C.walk) * ease(dt, 12) }
        if (t >= .3 && t < .75) { stepTo(p.sx); C.alpha = clamp(1 - (t - .5) / .25, 0, 1); C.scaleX = mix(1, .4, clamp((t - .5) / .25, 0, 1)) }
        else if (t >= .75 && !p.jumped) { p.jumped = true; C.x = p.dx; sparkBurst(p.sx, GY - 8, 8, ['#c4b5fd', '#fff']); sparkBurst(p.dx, GY - 8, 8, ['#c4b5fd', '#fff']) }
        if (t >= .95 && t < 1.45) { stepTo(p.tx); C.alpha = clamp((t - .95) / .25, 0, 1); C.scaleX = mix(.4, 1, clamp((t - .95) / .25, 0, 1)) }
        if (t >= 1.45) C.walk += (0 - C.walk) * ease(dt, 10)
        if (t >= 1.75) { C.portal = null; C.alpha = 1; C.scaleX = 1; setState('idle'); C.idleT = rnd(1, 2) }
        break
      }
      case 'air': {
        C.z += C.vz * dt; C.vz -= G * dt; C.x += C.vx * dt
        if (C.flipRate) { C.rot += C.flipRate * dt; if (Math.abs(C.rot) >= TAU) { C.rot = 0; C.flipRate = 0 } }
        else C.rot += (0 - C.rot) * ease(dt, 8)
        if (C.x < 8 || C.x > W - 8) { C.x = clamp(C.x, 8, W - 8); C.vx *= -.6 }
        if (C.exiting) { if (C.z < -20) { hide(); return } break }
        if (C.z <= 0 && C.vz < 0) {
          const imp = -C.vz; C.z = 0
          if (imp > 70 && C.bounces < 1) { C.vz = imp * .32; C.bounces++; C.vx *= .7; C.sq = clamp(imp / 220, .25, .7); dustBurst(C.x, 5) }
          else land()
        }
        break
      }
      case 'held': {
        const tx = M.x + C.gx, ty = M.y + C.gy
        C.fx += (tx - C.fx) * ease(dt, 22); C.fy += (ty - C.fy) * ease(dt, 22)
        C.fy = Math.min(C.fy, GY)
        C.x = clamp(C.fx, 6, W - 6)
        C.z += (Math.max(3, GY - C.fy) - C.z) * ease(dt, 14)
        C.rot += (clamp(M.vx * .004, -.8, .8) + Math.sin(time * 5) * .04 - C.rot) * ease(dt, 9)
        const sgn = Math.sign(M.vx)
        if (Math.abs(M.vx) > 110 && sgn !== C.lastSign) { C.shake++; C.lastSign = sgn }
        if (C.shake > 6 && !C.orbitDone) { C.orbitDone = true; for (let i = 0; i < 3; i++) emit({ type: 'orbit', ang: i * 2.1, life: 6, col: '#ffd23f' }) }
        break
      }
      case 'dizzy': {
        C.t += dt
        if (C.t < dt * 1.5) for (let i = 0; i < 3; i++) emit({ type: 'orbit', ang: i * 2.1, life: 3.2, col: '#ffd23f' })
        C.x += Math.sin(C.t * 3) * 18 * dt; C.phase += dt * 8; C.walk = .6; C.rot = Math.sin(C.t * 5) * .22
        if (C.t > 3.2) { C.rot = 0; C.walk = 0; setState('idle'); say('plus jamais', 1200) }
        break
      }
      case 'warn': {
        C.t += dt; C.walk += (0 - C.walk) * ease(dt, 10)
        C.rot += (-(C.dir < 0 ? -1 : 1) * C.kick * .12 - C.rot) * ease(dt, 20)
        if (C.t > .55 && !C.shot) { C.shot = true; fireShot(false) }
        if (C.shot && C.t > 1.3 && C.t - dt <= 1.3) say('c’était un avertissement.', 1400)
        if (C.t > 2.2) { C.rot = 0; setState('idle'); setFace('annoyed', 1.4); C.idleT = 1.5 }
        break
      }
      case 'spray': {
        C.t += dt; C.walk += (0 - C.walk) * ease(dt, 10)
        C.rot += (-(C.dir < 0 ? -1 : 1) * C.kick * .1 + Math.sin(time * 45) * .018 - C.rot) * ease(dt, 20)
        if (C.t > .6 && C.t < 2.5) { C.sprayT -= dt; if (C.sprayT <= 0) { C.sprayT = .075; fireShot(true) } }
        if (C.t > 2.5 && C.t - dt <= 2.5) say('…ok. je suis calmé.', 1600)
        if (C.t > 3.3) { C.rot = 0; setState('idle'); setFace('annoyed', 1.4); C.idleT = 1.5 }
        break
      }
      case 'sleep': {
        C.t += dt; C.walk += (0 - C.walk) * ease(dt, 10)
        C.zT -= dt
        if (C.zT <= 0) { C.zT = 1.1; emit({ type: 'zzz', x: C.x + C.face * 6, y: GY - C.z - 6, vx: 4, vy: -9, life: 2.2, col: '#8fb4ff' }) }
        if (hold || alertMsg) wake('')
        else if (C.t > SLEEP_LEAVE) leave('auto')
        break
      }
    }
    if (C.st === 'idle' || C.st === 'walk') {
      const target = C.petting > 0 ? Math.sin(time * 20) * .07 : C.act === 'shimmy' ? Math.sin(C.actT * 11) * .1 : 0
      C.rot += (target - C.rot) * ease(dt, 14)
    }
    if (!C.held) C.x = clamp(C.x, 6, W - 6)
    C.sqv += (-180 * C.sq - 14 * C.sqv) * dt; C.sq += C.sqv * dt
    updatePose(dt)
    updateHero(dt)

    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.life -= dt
      if (p.life <= 0) { P.splice(i, 1); continue }
      if (p.type === 'orbit') {
        p.ang += dt * 7; p.x = C.x + Math.cos(p.ang) * 6; p.y = GY - C.z - 17 + Math.sin(p.ang) * 2
        if (C.st !== 'dizzy' && !(C.st === 'held' && C.shake > 6)) p.life = Math.min(p.life, .2)
        continue
      }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt
      if (p.type === 'zzz') p.x += Math.sin(p.life * 5) * 10 * dt
      if (p.gy !== undefined && p.y > p.gy) { p.y = p.gy; p.vy *= -.3; p.vx *= .6 }
    }
    M.px = M.x; M.py = M.y
  }

  function frame(now: number) {
    raf = 0
    const dt = Math.min((now - last) / 1000, .05) || .016
    last = now; time += dt
    update(dt); render()
    if (C.st !== 'hidden') raf = requestAnimationFrame(frame)
  }
  function startLoop() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame) } }

  /* ---------- guidage : voler jusqu'à un élément et le montrer ---------- */
  /** Point d'atterrissage à côté de l'élément : côté le plus dégagé, Auto entièrement visible (marges de sécurité). */
  function landingFor(r: DOMRect): { x: number; z: number } {
    const right = innerWidth - r.right >= r.left
    const x = clamp(right ? r.right / S + 9 : r.left / S - 9, 10, W - 10)
    const feet = clamp((r.top + r.bottom) / 2 / S + 9, 22, GY) // épaule à hauteur du centre de l'élément ; tête et bulle dans l'écran
    return { x, z: GY - feet }
  }
  function startFly(x1: number, z1: number, next: 'guide' | 'home', onArrive?: () => void) {
    const dist = Math.hypot(x1 - C.x, z1 - C.z)
    C.fly = { x0: C.x, z0: C.z, x1, z1, dur: clamp(dist / 170, .55, 1.15), arc: Math.min(28, dist * .22) + 5, next, onArrive }
    if (Math.abs(x1 - C.x) > 1) C.dir = Math.sign(x1 - C.x)
    C.flipRate = 0; C.held = false; C.exiting = false; C.arriving = false; C.portal = null; C.alpha = 1; C.scaleX = 1
    if (C.z < .5) dustBurst(C.x, 4)
    setState('fly')
  }
  function guide(opts: { rect: () => DOMRect | null; text: string; onArrive?: () => void }) {
    const r = opts.rect(); if (!r) return
    if (C.st === 'hidden') { // masqué : il réapparaît à son coin puis s'envole
      scan()
      const segs = segments()
      C.x = segs.length ? homeX(segs, C.home) : W - 12
      Object.assign(C, { z: 0, vz: 0, vx: 0, rot: 0, lie: 0, sq: 0, sqv: 0, alpha: 1, scaleX: 1, faceT: 0 })
      C.cape.px = undefined; setState('idle'); updateHero(.016); startLoop()
    }
    setPresence('present'); touch()
    guideRect = opts.rect
    const L = landingFor(r)
    say(opts.text, 6500)
    if (reduced) { C.fly = null; C.x = L.x; C.z = L.z; C.guideZ = L.z; C.rot = 0; setState('guide'); opts.onArrive?.(); return }
    startFly(L.x, L.z, 'guide', opts.onArrive)
  }
  function endGuide() {
    guideRect = null
    if (C.st !== 'guide' && C.st !== 'fly') return
    if (C.sayT > .6 && C.sayT !== Infinity) C.sayT = .6
    const segs = segments(), hx = segs.length ? homeX(segs, C.home) : C.x
    touch()
    if (reduced) { C.fly = null; C.x = hx; C.z = 0; C.rot = 0; setState('idle'); return }
    startFly(hx, 0, 'home')
  }

  /* ---------- entrée / sortie ---------- */
  function enter(greet = '') {
    if (C.st !== 'hidden') {
      if (pres !== 'leaving') { if (greet) say(greet, 2200); touch(); return }
      hide() // on le rappelle pendant qu'il part : il revient aussitôt
    }
    scan()
    const segs = segments()
    C.x = segs.length ? homeX(segs, C.home) : C.home === 'right' ? W - 12 : 12
    C.dir = C.face = C.x > W / 2 ? -1 : 1
    Object.assign(C, { z: 0, vz: 0, vx: 0, rot: 0, flipRate: 0, lie: 0, walk: 0, sq: 0, sqv: 0, alpha: 1, scaleX: 1, exiting: false, held: false, poke: 0, goal: null, portal: null, faceT: 0 })
    C.cape.px = undefined
    C.greet = greet; touch(); setPresence('entering')
    if (reduced) { C.alpha = 0; setState('fadeIn') } else { C.z = -17; C.armK = 1; setState('climbUp') }
    updateHero(.016)
    startLoop()
  }
  function leave(how: 'jump' | 'climb' | 'auto' = 'auto') {
    if (C.st === 'hidden' || pres === 'leaving') return
    press = null; C.held = false; C.goal = null; C.portal = null; C.alpha = 1; C.scaleX = 1; C.arriving = false
    setPresence('leaving')
    if (reduced) { setState('fadeOut'); return }
    const h = how === 'auto' ? (Math.random() < .5 ? 'jump' : 'climb') : how
    if (h === 'jump') { C.exiting = true; jump(150, 0); if (Math.random() < .6) C.flipRate = TAU / .75 * (C.dir || 1) }
    else { C.armStart = C.rR; C.fallV = 0; setState('climbDown') }
  }

  /* ---------- entrées utilisateur ---------- */
  const unit = (e: PointerEvent | MouseEvent) => ({ x: e.clientX / S, y: e.clientY / S })
  const onMove = (e: PointerEvent) => {
    const p = unit(e)
    if (!M.inside) { M.px = p.x; M.py = p.y }
    M.x = p.x; M.y = p.y; M.inside = true; M.lastMove = time
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.ctrlKey) return // clic droit / Ctrl+clic : menu contextuel
    e.preventDefault()
    const p = unit(e)
    M.x = M.px = p.x; M.y = M.py = p.y; M.inside = true; M.down = true; M.lastMove = time
    try { hit.setPointerCapture(e.pointerId) } catch { /* pointeur déjà relâché */ }
    press = { x: p.x, y: p.y, skip: false }
    if (C.st === 'sleep') { wake('hein ?!'); press.skip = true }
    else if (!CLICKABLE.has(C.st)) press.skip = true
  }
  const onUp = () => {
    M.down = false
    if (C.held) release()
    else if (press && !press.skip) click()
    press = null
  }
  const onKeyClick = (e: MouseEvent) => { // Entrée / Espace sur le bouton focalisé
    if (e.detail !== 0) return
    touch(); if (C.st === 'sleep') wake('')
    hooks.onChat(); say(pick(CHAT), 1600)
  }
  const onContext = (e: MouseEvent) => {
    e.preventDefault(); touch()
    if (C.st === 'sleep') wake('')
    hooks.onMenu(api.anchor())
  }
  const onBulb = (e: MouseEvent) => { e.stopPropagation(); touch(); hooks.onBulb({ x: bulbPos.x * S, y: (bulbPos.y - 3) * S }) }
  const onBulbDown = (e: PointerEvent) => e.stopPropagation()
  const onEnter = () => { C.hover = true }
  const onLeave = () => { C.hover = false }
  const onOut = () => { M.inside = false }

  hit.addEventListener('pointerdown', onDown)
  hit.addEventListener('pointerenter', onEnter)
  hit.addEventListener('pointerleave', onLeave)
  hit.addEventListener('click', onKeyClick)
  hit.addEventListener('contextmenu', onContext)
  bulbHit.addEventListener('click', onBulb)
  bulbHit.addEventListener('pointerdown', onBulbDown)
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  document.documentElement.addEventListener('mouseleave', onOut)
  window.addEventListener('resize', resize)
  resize()

  const api: AutoEngine = {
    enter, leave,
    presence: () => pres,
    say: (t, ms) => { touch(); say(t, ms) },
    setDark: (on) => { dark = on },
    setReducedMotion: (on) => { reduced = on },
    setHold: (on) => { hold = on },
    setBulb: (on) => { bulbOn = on; if (on) touch() },
    setAlert: (msg) => {
      const was = alertMsg; alertMsg = msg
      if (msg) { touch(); say(msg, Infinity) }
      else if (was && C.sayT === Infinity) C.sayT = 0
    },
    rescan: () => { if (C.st !== 'hidden') scan() },
    anchor: () => ({ x: C.x * S, y: (GY - C.z - (bulbOn || alertMsg ? 25 : 18)) * S }),
    guide, endGuide,
    destroy: () => {
      cancelAnimationFrame(raf); raf = 0
      hit.removeEventListener('pointerdown', onDown); hit.removeEventListener('pointerenter', onEnter); hit.removeEventListener('pointerleave', onLeave)
      hit.removeEventListener('click', onKeyClick); hit.removeEventListener('contextmenu', onContext); bulbHit.removeEventListener('click', onBulb); bulbHit.removeEventListener('pointerdown', onBulbDown)
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp)
      document.documentElement.removeEventListener('mouseleave', onOut); window.removeEventListener('resize', resize)
    },
  }
  return api
}
