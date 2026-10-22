// Brücke. Zwei Arten zu setzen:
// - mit Weg (params.path, Fassung 15): Start, Zwischenpunkte, Ziel geklickt. Die Brücke wird erst gerade gebaut
//   (Länge = Weglänge, Gelände entlang des Wegs) und dann auf den Weg gebogen: jede Weltzelle nimmt die Säule der
//   nächstgelegenen Stelle der geraden Brücke, gedreht nach der Richtung des Wegstücks.
// - ohne Weg (ältere Bauwerke): spannt sich selbst entlang der lokalen x-Achse von Ufer zu Ufer übers Wasser.
// Breite (3–9) und Deko (0 wenig, 1 normal, 2 viel) lassen sich am gesetzten Bauwerk ändern.

import type { BlockState } from '../blueprint/blockstate'
import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { transformState, type Rotation } from '../blueprint/transform'
import { Builder, groundAt, isWet, type Ground } from '../style/builder'
import type { Size } from './styles'
import { setup } from './small'

type BridgeForm = 'bogen' | 'balken' | 'ueberdacht' | 'haenge' | 'buckel' | 'flach'
const LABEL: Record<BridgeForm, string> = {
  bogen: 'Steinbogen', balken: 'Holzsteg', ueberdacht: 'Überdacht', haenge: 'Hängebrücke', buckel: 'Bogenbrücke', flach: 'Flach',
}
const FORMS: Record<string, BridgeForm[]> = {
  mittelalter: ['bogen', 'balken', 'ueberdacht'],
  japan: ['buckel', 'balken', 'haenge'],
  modern: ['flach', 'haenge'],
  wueste: ['bogen', 'balken'],
  steampunk: ['ueberdacht', 'haenge', 'bogen'],
}

export function bridgeForms(style: string): { id: string; label: string }[] {
  return (FORMS[style] ?? FORMS.mittelalter).map(id => ({ id, label: LABEL[id] }))
}

/** halbe Breite: S 3, M 5, L 7 Blöcke breit */
const HALF: Record<Size, number> = { S: 1, M: 2, L: 3 }
/** Länge ohne Wasser in der Nähe */
const FALLBACK: Record<Size, number> = { S: 9, M: 13, L: 17 }
/** so weit sucht die Brücke nach Wasser und Ufer */
const REACH = 32
const RAMP = 6

export interface BridgeParams {
  form?: string
  size?: Size
  /** Breite in Blöcken (ungerade, 3–9); ohne: aus der Größe */
  width?: number
  /** 0 wenig, 1 normal, 2 viel */
  deco?: number
  /** Weg in lokalen Koordinaten (erster Punkt = Anker, [0, 0]) */
  path?: [number, number][]
  ground?: Ground
}

export const BRIDGE_WIDTHS = [3, 5, 7, 9]

function halfWidth(p: BridgeParams): number {
  if (p.width) return Math.max(1, Math.min(4, (p.width - 1) >> 1))
  return HALF[p.size ?? 'M']
}

export function bridgeExtent(source: BlueprintSource) {
  const p = source.params as BridgeParams
  const hw = halfWidth(p)
  if (p.path && p.path.length >= 2) {
    const m = hw + RAMP + 4
    const xs = p.path.map(q => q[0]), zs = p.path.map(q => q[1])
    return { x0: Math.min(...xs) - m, z0: Math.min(...zs) - m, x1: Math.max(...xs) + m, z1: Math.max(...zs) + m }
  }
  return { x0: -REACH - RAMP - 2, z0: -hw - 1, x1: REACH + RAMP + 2, z1: hw + 1 }
}

/** Ufer zu Ufer: erste und letzte Spalte an Land (a, e), dazu Wasserspiegel. */
export function bridgeSpan(g: Ground | undefined, size: Size, hw = HALF[size]): { a: number; e: number; water: number; overWater: boolean } {
  const wet = (x: number) => { for (let z = -hw; z <= hw; z++) if (isWet(g, x, z)) return true; return false }
  let start: number | null = null
  for (let d = 0; d <= REACH && start === null; d++) for (const x of d ? [d, -d] : [0]) if (start === null && wet(x)) start = x
  if (start === null) {
    const n = FALLBACK[size] >> 1
    return { a: -n, e: n, water: -1, overWater: false }
  }
  let a = start, e = start
  while (a > -REACH && wet(a - 1)) a--
  while (e < REACH && wet(e + 1)) e++
  return { a: a - 1, e: e + 1, water: g?.water ?? 0, overWater: true }
}

export function buildBridge(source: BlueprintSource): Blueprint {
  const { st, b, g } = setup(source)
  const p = source.params as BridgeParams
  const form: BridgeForm = (FORMS[st.id] ?? FORMS.mittelalter).includes(p.form as BridgeForm)
    ? (p.form as BridgeForm)
    : (FORMS[st.id] ?? FORMS.mittelalter)[0]
  const hw = halfWidth(p)
  const deco = p.deco ?? 1
  const name = `${LABEL[form]} (${st.label})`
  if (p.path && p.path.length >= 2) return pathBridge(source, form, hw, deco, name)
  const { a, e, water: W } = bridgeSpan(g, p.size ?? 'M', hw)
  straight(b, g, form, st.id, a, e, W, hw, deco)
  return b.toBlueprint(name, source)
}

/** Gerade Brücke von Spalte a bis e (beide an Land) entlang x, Wasserspiegel W, in den Builder b. */
function straight(b: Builder, g: Ground | undefined, form: BridgeForm, style: string, a: number, e: number, W: number, hw: number, deco: number): void {
  const n = e - a - 1 // Spalten über dem Wasser
  const bank = Math.max(groundAt(g, a, 0), groundAt(g, e, 0))
  // Fahrbahnhöhe: Platz für ein Boot (eine Reihe Luft über dem Wasser), Steinbögen höher, damit man den Bogen sieht
  const clearance = form === 'bogen' ? 3 + Math.min(3, Math.floor(n / 6)) : form === 'ueberdacht' || form === 'haenge' ? 3 : 2
  const H = Math.max(W + clearance, bank)
  const ctx: Ctx = { b, g, a, e, n, W, H, hw, light: b.main('light'), style, deco }

  if (form === 'bogen') stoneArch(ctx)
  else if (form === 'balken') timber(ctx, false)
  else if (form === 'ueberdacht') timber(ctx, true)
  else if (form === 'haenge') suspension(ctx)
  else if (form === 'buckel') drum(ctx)
  else flat(ctx)
  ramps(ctx, form === 'bogen' || form === 'flach' ? 'sockel' : 'floor')
  if (deco >= 2) flowers(ctx)
}

type P2 = [number, number]

/**
 * Brücke entlang eines geklickten Wegs: gerade bauen, dann umbiegen.
 * Das Gelände der geraden Brücke wird entlang des Wegs abgelesen (Spalte s, Querversatz t → Weltzelle).
 */
function pathBridge(source: BlueprintSource, form: BridgeForm, hw: number, deco: number, name: string): Blueprint {
  const { st, b: out, g } = setup(source)
  const pts = (source.params as BridgeParams).path!.filter((q, i, all) => i === 0 || q[0] !== all[i - 1][0] || q[1] !== all[i - 1][1])
  if (pts.length < 2) pts.push([pts[0][0] + 1, pts[0][1]])
  const segs = pts.slice(0, -1).map((A, i) => {
    const B = pts[i + 1]
    const len = Math.hypot(B[0] - A[0], B[1] - A[1])
    return { A, B, len, d: [(B[0] - A[0]) / len, (B[1] - A[1]) / len] as P2, s0: 0 }
  })
  let acc = 0
  for (const sg of segs) {
    sg.s0 = acc
    acc += sg.len
  }
  const L = acc
  const n = Math.max(3, Math.round(L))
  const unit = L / n // Weglänge je Spalte der geraden Brücke
  const R = RAMP + 2
  // Stelle auf dem (an den Enden verlängerten) Weg
  const at = (s: number): { p: P2; d: P2; seg: number } => {
    let i = segs.findIndex(sg => s < sg.s0 + sg.len)
    if (i < 0) i = segs.length - 1
    if (s < 0) i = 0
    const sg = segs[i], u = s - sg.s0
    return { p: [sg.A[0] + sg.d[0] * u, sg.A[1] + sg.d[1] * u], d: sg.d, seg: i }
  }

  // Gelände der geraden Brücke: Spalte s (x), Querversatz t (z) → Weltzelle neben dem Weg
  const g2: Ground = { x0: -R, z0: -hw - 1, w: n + 2 * R + 1, d: 2 * hw + 3, h: [], wet: [] }
  for (let k = 0; k < g2.d; k++)
    for (let i = 0; i < g2.w; i++) {
      const s = (g2.x0 + i) * unit, t = g2.z0 + k
      const { p, d } = at(s)
      const cx = Math.round(p[0] - d[1] * t), cz = Math.round(p[1] + d[0] * t)
      g2.h.push(groundAt(g, cx, cz))
      if (isWet(g, cx, cz)) g2.wet!.push(k * g2.w + i)
    }
  const W = g2.wet!.length ? (g?.water ?? 0) : -1
  if (g2.wet!.length) g2.water = W
  const flat = new Builder(out.palette, source.seed)
  straight(flat, g2, form, st.id, 0, n, W, hw, deco)
  const cols = new Map<string, [number, BlockState][]>()
  for (const [x, y, z, s] of flat.entries()) {
    const k = `${x},${z}`
    if (!cols.has(k)) cols.set(k, [])
    cols.get(k)!.push([y, s])
  }

  // Umbiegen: jede Weltzelle nahe am Weg nimmt die Säule der nächstgelegenen Stelle der geraden Brücke
  const reach = hw + 2
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let s = -R * unit; s <= L + R * unit; s += 0.5) {
    const { p } = at(s)
    x0 = Math.min(x0, p[0] - reach); x1 = Math.max(x1, p[0] + reach)
    z0 = Math.min(z0, p[1] - reach); z1 = Math.max(z1, p[1] + reach)
  }
  const rotOf = segs.map(sg => ((((Math.round(Math.atan2(sg.d[1], sg.d[0]) / (Math.PI / 2)) % 4) + 4) % 4) * 90) as Rotation)
  for (let z = Math.floor(z0); z <= Math.ceil(z1); z++)
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      let best = Infinity, bs = 0, bt = 0, bi = 0
      segs.forEach((sg, i) => {
        const vx = x - sg.A[0], vz = z - sg.A[1]
        let u = vx * sg.d[0] + vz * sg.d[1]
        const lo = i === 0 ? -R * unit : 0, hi = i === segs.length - 1 ? sg.len + R * unit : sg.len
        u = Math.max(lo, Math.min(hi, u))
        const px = sg.A[0] + sg.d[0] * u, pz = sg.A[1] + sg.d[1] * u
        const dist = Math.hypot(x - px, z - pz)
        if (dist < best - 1e-9) {
          best = dist
          bs = sg.s0 + u
          bt = (x - px) * -sg.d[1] + (z - pz) * sg.d[0]
          bi = i
        }
      })
      if (best > hw + 1.5) continue
      const col = cols.get(`${Math.round(bs / unit)},${Math.max(-hw - 1, Math.min(hw + 1, Math.round(bt)))}`)
      if (!col) continue
      for (const [y, s] of col) out.set(x, y, z, transformState(s, rotOf[bi]))
    }
  out.anchor = [0, 0, 0]
  return out.toBlueprint(name, source)
}


interface Ctx {
  b: Builder
  g: Ground | undefined
  a: number
  e: number
  n: number
  W: number
  H: number
  hw: number
  light: string
  style: string
  /** 0 wenig, 1 normal, 2 viel */
  deco: number
}

/** Viel Deko: Blumentöpfe auf dem Geländer zwischen den Laternen. */
function flowers(c: Ctx): void {
  const pots = ['potted_red_tulip', 'potted_cornflower', 'potted_allium', 'potted_oxeye_daisy', 'potted_azure_bluet', 'potted_poppy']
  for (let x = c.a + 2; x <= c.e - 2; x += 3)
    for (const z of [-c.hw, c.hw])
      for (let y = c.H + 4; y >= c.H; y--) {
        const s = c.b.get(x, y, z)
        if (!s) continue
        if (/_(fence|wall)\b|_fence\[|_wall\[/.test(s) && !c.b.has(x, y + 1, z)) c.b.set(x, y + 1, z, `minecraft:${pots[Math.floor(c.b.noise(x, y, z, 5) * pots.length)]}`)
        break
      }
}

/** Geländer: Mauer, sonst Zaun. */
function rail(b: Builder, x: number, y: number, z: number, role: 'sockel' | 'detail'): void {
  try {
    b.form(x, y, z, role, role === 'sockel' ? 'wall' : 'fence')
  } catch {
    b.form(x, y, z, 'detail', 'fence')
  }
}

/** Auflager an beiden Ufern bis zum Grund auffüllen. */
function abutments(c: Ctx, role: 'sockel' | 'frame'): void {
  for (const x of [c.a, c.e])
    for (let z = -c.hw; z <= c.hw; z++)
      for (let y = Math.max(-12, groundAt(c.g, x, z)) + 1; y < c.H; y++) role === 'frame' ? c.b.beam(x, y, z, 'frame', 'y') : c.b.role(x, y, z, 'sockel', {}, 1)
}

/** Rampen nach außen, wo das Ufer tiefer liegt als die Fahrbahn. */
function ramps(c: Ctx, role: 'sockel' | 'floor'): void {
  for (const [x0, dir, facing] of [[c.a, -1, 'east'], [c.e, 1, 'west']] as const) {
    for (let k = 1; k <= RAMP; k++) {
      const x = x0 + dir * k, y = c.H - k
      let done = true
      for (let z = -c.hw; z <= c.hw; z++) {
        const gy = groundAt(c.g, x, z)
        if (y <= gy) continue
        done = false
        try {
          c.b.form(x, y, z, role, 'stairs', { facing, half: 'bottom' })
        } catch {
          c.b.form(x, y, z, 'sockel', 'stairs', { facing, half: 'bottom' })
        }
        for (let yy = Math.max(-12, gy) + 1; yy < y; yy++) c.b.role(x, yy, z, 'sockel', {}, 1)
      }
      if (done) break
    }
  }
}

function endLanterns(c: Ctx, y: number): void {
  if (!c.deco) return
  for (const x of [c.a, c.e]) for (const z of [-c.hw, c.hw]) c.b.set(x, y, z, `${c.light}[hanging=false]`)
}

/** Steinbogen: Gewölbe aus Sockel, bei langen Brücken Pfeiler im Wasser, Brüstung aus Mauer, Weg obenauf. */
function stoneArch(c: Ctx): void {
  const { b, a, e, W, H, hw } = c
  const arches = Math.max(1, Math.ceil(c.n / 11))
  const supports = [a]
  for (let i = 1; i < arches; i++) supports.push(Math.round(a + ((e - a) * i) / arches))
  supports.push(e)
  for (let s = 0; s < supports.length - 1; s++) {
    const s0 = supports[s], s1 = supports[s + 1]
    for (let x = s0 + 1; x < s1; x++) {
      const t = (x - s0) / (s1 - s0)
      const ceil = Math.round(W + 1 + (H - 2 - (W + 1)) * Math.sin(Math.PI * t))
      for (let z = -hw; z <= hw; z++) for (let y = ceil + 1; y < H; y++) b.role(x, y, z, 'sockel', {}, -99)
    }
  }
  // Pfeiler bis zum Flussgrund
  for (const x of supports.slice(1, -1))
    for (let z = -hw; z <= hw; z++) for (let y = Math.max(-12, groundAt(c.g, x, z)) + 1; y < H; y++) b.role(x, y, z, 'sockel', {}, -99)
  abutments(c, 'sockel')
  for (let x = a; x <= e; x++)
    for (let z = -hw; z <= hw; z++) {
      if (Math.abs(z) === hw) {
        b.role(x, H, z, 'sockel', {}, -99)
        rail(b, x, H + 1, z, 'sockel')
      } else b.role(x, H, z, 'path')
    }
  endLanterns(c, H + 2)
  // Laternen auf der Brüstung über den Pfeilern
  if (c.deco) for (const x of supports.slice(1, -1)) for (const z of [-hw, hw]) b.set(x, H + 2, z, `${c.light}[hanging=false]`)
}

/** Holzsteg auf Pfählen, Zaungeländer; überdacht mit Fachwerk-Pfosten und Satteldach. */
function timber(c: Ctx, covered: boolean): void {
  const { b, a, e, H, hw } = c
  for (let x = a; x <= e; x++) {
    for (let z = -hw; z <= hw; z++) {
      if (Math.abs(z) === hw) b.beam(x, H, z, 'frame', 'x')
      else b.role(x, H, z, 'floor')
    }
  }
  // Joche alle 4 Blöcke: zwei Pfähle bis zum Grund, Querbalken unter der Fahrbahn
  for (let x = a + 2; x < e - 1; x += 4) {
    for (const z of [-hw, hw]) for (let y = Math.max(-12, groundAt(c.g, x, z)) + 1; y < H; y++) b.beam(x, y, z, 'frame', 'y')
    for (let z = -hw + 1; z < hw; z++) b.beam(x, H - 1, z, 'frame', 'z')
  }
  abutments(c, 'sockel')
  if (!covered) {
    for (let x = a; x <= e; x++) for (const z of [-hw, hw]) rail(b, x, H + 1, z, 'detail')
    endLanterns(c, H + 2)
    if (c.deco) for (let x = a + 4; x < e - 2; x += c.deco > 1 ? 4 : 8) b.set(x, H + 2, -hw, `${c.light}[hanging=false]`)
    return
  }
  // Überdacht: Pfosten alle 3 Blöcke, dazwischen Brüstung, Rähm, Satteldach entlang der Brücke
  const top = H + 4
  for (let x = a; x <= e; x++)
    for (const z of [-hw, hw]) {
      const post = (x - a) % 3 === 0 || x === e
      for (let y = H + 1; y < top; y++) {
        if (post) b.beam(x, y, z, 'frame', 'y')
        else if (y === H + 1) rail(b, x, y, z, 'detail')
      }
      b.beam(x, top, z, 'frame', 'x')
    }
  for (let x = a - 1; x <= e + 1; x++) {
    for (let d = hw + 1, y = top; d >= 1; d--, y++) {
      const role = d === hw + 1 ? 'trim' : 'roof'
      b.form(x, y, -d, role, 'stairs', { facing: 'south', half: 'bottom' })
      b.form(x, y, d, role, 'stairs', { facing: 'north', half: 'bottom' })
    }
    b.form(x, top + hw + 1, 0, 'trim', 'slab', { type: 'bottom' })
  }
  if (c.deco) for (let x = a + 2; x < e - 1; x += c.deco > 1 ? 3 : 5) b.set(x, top + hw, 0, `${c.light}[hanging=true]`)
}

/** Hängebrücke: Türme an beiden Ufern, Fahrbahn hängt leicht durch, Tragseil aus Zaun, Hänger aus Ketten. */
function suspension(c: Ctx): void {
  const { b, a, e, W, H, hw } = c
  const sag = Math.min(2, Math.floor(c.n / 8), H - (W + 2))
  const deckY = (x: number) => H - Math.round(sag * Math.sin((Math.PI * (x - a)) / (e - a)))
  const tower = H + 5
  for (let x = a; x <= e; x++) {
    const y = deckY(x)
    for (let z = -hw; z <= hw; z++) {
      if (Math.abs(z) === hw) b.beam(x, y, z, 'frame', 'x')
      else b.form(x, y, z, 'detail', 'slab', { type: 'top' })
    }
  }
  abutments(c, 'sockel')
  for (const x of [a, e]) {
    for (const z of [-hw, hw]) for (let y = H + 1; y <= tower; y++) b.beam(x, y, z, 'frame', 'y')
    for (let z = -hw + 1; z < hw; z++) b.beam(x, tower, z, 'frame', 'z')
    if (c.deco) for (const z of [-hw, hw]) b.set(x, tower + 1, z, `${c.light}[hanging=false]`)
  }
  const chain = c.style === 'steampunk' ? 'minecraft:copper_chain[axis=y]' : 'minecraft:iron_chain[axis=y]'
  // Tragseil als Parabel vom Turmkopf zur Mitte; Sprünge zwischen Nachbarn senkrecht auffüllen, damit es durchläuft
  const cableY = (x: number) => {
    const t = (x - a) / (e - a), y0 = deckY(x) + 1
    return Math.max(y0 + 1, Math.round(y0 + 1 + (tower - 1 - (y0 + 1)) * (2 * t - 1) ** 2))
  }
  for (let x = a + 1; x < e; x++) {
    const y0 = deckY(x) + 1, cable = cableY(x)
    const lo = Math.min(cable, x - 1 > a ? cableY(x - 1) : tower - 1, x + 1 < e ? cableY(x + 1) : tower - 1)
    for (const z of [-hw, hw]) {
      for (let y = Math.max(lo, cable - 3); y <= cable; y++) rail(b, x, y, z, 'detail')
      if ((x - a) % 2 === 0) for (let y = y0 + 1; y < Math.max(lo, cable - 3); y++) b.set(x, y, z, chain)
      b.form(x, y0, z, 'detail', 'fence')
    }
  }
}

/** Bogenbrücke (Japan, Taikobashi): Fahrbahn steigt zur Mitte an, Stufen statt Rampe, Geländer folgt dem Bogen. */
function drum(c: Ctx): void {
  const { b, a, e, H, hw } = c
  const rise = Math.max(1, Math.min(4, Math.floor((e - a) / 4)))
  const y = (x: number) => H + Math.round(rise * Math.sin((Math.PI * (x - a)) / (e - a)))
  for (let x = a; x <= e; x++) {
    const here = y(x), next = x < e ? y(x + 1) : here, prev = x > a ? y(x - 1) : here
    for (let z = -hw; z <= hw; z++) {
      if (Math.abs(z) === hw) b.beam(x, here, z, 'frame', 'x')
      else b.role(x, here, z, 'floor')
      // Stufe zum höheren Nachbarn
      if (Math.abs(z) < hw && next > here) b.form(x, here + 1, z, 'floor', 'stairs', { facing: 'east', half: 'bottom' })
      if (Math.abs(z) < hw && prev > here) b.form(x, here + 1, z, 'floor', 'stairs', { facing: 'west', half: 'bottom' })
    }
    for (const z of [-hw, hw]) {
      const top = Math.max(here, next, prev)
      for (let yy = here + 1; yy <= top + 1; yy++) rail(b, x, yy, z, 'detail')
    }
  }
  // Stützen unter dem Bogen
  for (const x of [a + 1, e - 1, Math.round((a + e) / 2)])
    for (const z of [-hw, hw]) for (let yy = Math.max(-12, groundAt(c.g, x, z)) + 1; yy < y(x); yy++) b.beam(x, yy, z, 'frame', 'y')
  abutments(c, 'sockel')
  // Laternen auf den Pfosten an den Enden
  if (c.deco) for (const x of [a, e]) for (const z of [-hw, hw]) b.set(x, y(x) + 2, z, `${c.light}[hanging=false]`)
}

/** Flach (Modern): Platte aus Sockel auf schlanken Pfeilern, Glasgeländer, Lichter in der Kante. */
function flat(c: Ctx): void {
  const { b, a, e, H, hw } = c
  for (let x = a; x <= e; x++)
    for (let z = -hw; z <= hw; z++) {
      b.role(x, H, z, Math.abs(z) === hw ? 'trim' : 'sockel', {}, -99)
      if (Math.abs(z) === hw) b.set(x, H + 1, z, 'minecraft:glass_pane')
    }
  for (let x = a + 4; x < e - 2; x += 6) {
    for (let y = Math.max(-12, groundAt(c.g, x, 0)) + 1; y < H; y++) b.role(x, y, 0, 'sockel', {}, -99)
    for (const z of [-hw, hw]) b.set(x, H, z, 'minecraft:sea_lantern')
  }
  abutments(c, 'sockel')
}
