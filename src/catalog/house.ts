// Haus-Generator: ein Haus aus Baukörpern (Hauptbau, Flügel, Zwerchgiebel, Turm, Anbau, zweiter Teil),
// deren Dächer ineinanderlaufen, dazu Deko je Stil (Vorbau, Bank, Fässer, Beete, Efeu, Balkenköpfe).
// Würfeln wechselt die Form, nicht nur die Blöcke.
// Lokale Koordinaten: Hauptbau x 0…w-1, z 0…d-1, Eingang an der Südseite (+z).
// y = 0 ist die Höhe des Geländeblocks am Anker; der Sockel folgt dem Gelände nach unten.

import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { Builder, choose, groundAt, isSoil, randInt, rng, type Facing, type Ground } from '../style/builder'
import { getPalette, type Role } from '../style/palettes'
import { styleById, type HouseForm, type RoofKind, type Size, type Style } from './styles'
import type { Rect } from './footprint'

export interface HouseParams {
  style: string
  palette: string
  size: Size
  /** feste Bauform; ohne (oder 'alle') entscheidet der Seed */
  form?: HouseForm | 'alle'
  ground?: Ground
  /** Grundriss aus Wolle: Rechtecke, Hauptbau zuerst bei 0,0 (Eingang an seiner Südseite) */
  footprint?: Rect[]
  /** Dachform (nur Stile mit Satteldach, ab Version 3) */
  roofShape?: RoofShape
}

type VolRoof = RoofKind | 'spire' | 'shed' | 'halfhip' | 'gambrel'

/** Dachform zum Auswählen (ab Generator-Version 3); 'alle' = der Seed entscheidet */
export type RoofShape = 'alle' | 'sattel' | 'walm' | 'kruppelwalm' | 'mansard' | 'gauben'
export const ROOF_SHAPES: { id: RoofShape; label: string }[] = [
  { id: 'alle', label: 'Alle' },
  { id: 'sattel', label: 'Satteldach' },
  { id: 'walm', label: 'Walmdach' },
  { id: 'kruppelwalm', label: 'Krüppelwalm' },
  { id: 'mansard', label: 'Mansard' },
  { id: 'gauben', label: 'Mit Gauben' },
]

/** Ein Baukörper. Flügel und Anbauten hängen an einer Seite des Hauptbaus (dir). */
interface Vol {
  kind: 'main' | 'wing' | 'bay' | 'tower' | 'lean' | 'side'
  x0: number
  z0: number
  w: number
  d: number
  storeys: number
  roof: VolRoof
  ridge: 'x' | 'z'
  jetty: boolean
  /** Vorkragung auch an den Seiten (rundum) */
  jettyAll?: boolean
  dir?: Facing
}

interface Plan {
  form: HouseForm
  vols: Vol[]
  main: Vol
  sk: number
  sh: number
  ov: number
  cx: number
  cz: number
  door: { x: number; z: number }
  chimney: boolean
  /** steiles Dach: zwei Stufen je Schritt */
  steep: boolean
  /** Erdgeschoss aus Stein (Sockel-Material) */
  stoneBase: boolean
  /** Gauben auf den langen Dachseiten des Hauptbaus (ab Version 3) */
  dormers: boolean
  /** Balkon im ersten Obergeschoss über der Tür (ab Version 3) */
  balcony: boolean
  r: () => number
}

/**
 * Regeln ab Generator-Version 3 (Fassung 15, nach Minecraft-Wiki „Roof construction guidelines“ und „Roof types“):
 * Dachform aus Sattel, Walm, Krüppelwalm, Mansard; Gauben nur auf breiten Dächern (sonst kein Platz unter dem First),
 * Mansard erst ab 9 Breite (vorher nicht erkennbar); Balkon nur bei zwei und mehr Stockwerken.
 * Eigener Zufallsstrom, damit ältere Häuser (Version 2) gleich bleiben.
 */
function refine(source: BlueprintSource, pl: Plan): Plan {
  if (source.version < 3) return { ...pl, dormers: false, balcony: false }
  const p = source.params as unknown as HouseParams
  const st = styleById(p.style)
  const r2 = rng(source.seed * 6271 + 101)
  const m = pl.main
  const width = Math.min(m.w, m.d)
  let shape: RoofShape = p.roofShape ?? 'alle'
  if (st.roof !== 'gable') shape = 'alle'
  else if (shape === 'alle') {
    const pool: RoofShape[] = ['sattel', 'sattel', 'walm', 'kruppelwalm', 'kruppelwalm', 'gauben', 'gauben', ...(width >= 9 ? ['mansard', 'mansard'] as RoofShape[] : [])]
    shape = choose(r2, pool)
  }
  let roof = m.roof
  if (st.roof === 'gable') roof = shape === 'walm' ? 'hip' : shape === 'kruppelwalm' ? 'halfhip' : shape === 'mansard' ? 'gambrel' : 'gable'
  const main = { ...m, roof }
  const vols = pl.vols.map(v => (v === m ? main : v))
  return {
    ...pl, vols, main,
    steep: roof === 'gable' || roof === 'halfhip' ? pl.steep : false,
    dormers: shape === 'gauben' && width >= 9 && m.storeys >= 1,
    balcony: m.storeys >= 2 && !m.jetty && st.porch !== 'veranda' && r2() < 0.45,
  }
}

const DIRS: [Facing, number, number][] = [['south', 0, 1], ['north', 0, -1], ['east', 1, 0], ['west', -1, 0]]
const OUT: Record<Facing, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
const BACK: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' }

const odd = (n: number) => (n % 2 ? n : n - 1)

function plan(source: BlueprintSource): Plan {
  const p = source.params as unknown as HouseParams
  return refine(source, p.footprint?.length ? footprintPlan(source) : basePlan(source))
}

function basePlan(source: BlueprintSource): Plan {
  const p = source.params as unknown as HouseParams
  const st = styleById(p.style)
  const r = rng(source.seed * 7919 + 13)
  const form: HouseForm = p.form && p.form !== 'alle' && st.forms.includes(p.form) ? p.form : choose(r, st.forms)
  const [w, d] = choose(r, st.sizes[p.size])
  const storeys = choose(r, st.storeys[p.size])
  const roof: RoofKind = st.roof === 'gable' && r() < st.hipChance ? 'hip' : st.roof
  const jetty = st.jetty && storeys >= 2 && r() < 0.65
  const main: Vol = { kind: 'main', x0: 0, z0: 0, w, d, storeys, roof, ridge: d >= w ? 'z' : 'x', jetty, jettyAll: jetty && r() < st.jettyAllChance }
  // steil nur bei schmalen Häusern, sonst erschlägt das Dach den Bau
  const steep = roof === 'gable' && Math.min(w, d) <= 9 && r() < st.steepChance
  const stoneBase = storeys >= 2 && r() < st.stoneBaseChance
  const vols: Vol[] = [main]
  const side: Facing = r() < 0.5 ? 'east' : 'west'
  // Nebendächer: Satteldach bleibt Satteldach (Zwerchgiebel), sonst wie der Hauptbau
  const subRoof: VolRoof = roof
  switch (form) {
    case 'winkel': {
      const zw = odd(Math.max(5, Math.min(randInt(r, 5, 7), d - 2)))
      const xw = randInt(r, 4, 6)
      const front = r() < 0.6
      const s = Math.max(1, storeys - (storeys > 1 && r() < 0.5 ? 1 : 0))
      vols.push({ kind: 'wing', x0: side === 'east' ? w : -xw, z0: front ? d - zw : 0, w: xw, d: zw, storeys: s, roof: subRoof, ridge: 'x', jetty: false, dir: side })
      break
    }
    case 'zwerchgiebel': {
      const bw = w >= 9 ? 5 : 3
      vols.push({ kind: 'bay', x0: Math.floor(w / 2) - (bw >> 1), z0: d, w: bw, d: randInt(r, 2, 3), storeys, roof: subRoof, ridge: 'z', jetty: false, dir: 'south' })
      break
    }
    case 'turm': {
      const t = p.size === 'L' && r() < 0.5 ? 7 : 5
      const front = p.size !== 'S' && r() < 0.6
      const right = side === 'east'
      const x0 = right ? w - 2 : -(t - 2)
      const z0 = front ? d - 2 : -(t - 2)
      vols.push({ kind: 'tower', x0, z0, w: t, d: t, storeys: storeys + 1 + (p.size === 'L' ? 1 : 0), roof: st.towerRoof, ridge: 'z', jetty: false, dir: side })
      break
    }
    case 'anbau': {
      const xd = randInt(r, 3, 4)
      const zl = Math.max(3, d - 2 * randInt(r, 1, 2))
      const flat = roof === 'flat' || roof === 'parapet'
      vols.push({ kind: 'lean', x0: side === 'east' ? w : -xd, z0: r() < 0.5 ? d - zl : Math.floor((d - zl) / 2), w: xd, d: zl, storeys: 1, roof: flat ? roof : 'shed', ridge: 'z', jetty: false, dir: side })
      break
    }
    case 'doppel': {
      const w2 = odd(randInt(r, 5, 7))
      const d2 = Math.max(5, d + choose(r, [-2, -2, 2]))
      const s2 = storeys === 1 ? 2 : storeys - 1
      const z0 = choose(r, [-2, 0, 2])
      vols.push({ kind: 'side', x0: side === 'east' ? w : -w2, z0: Math.min(z0, d - d2 + 2), w: w2, d: d2, storeys: s2, roof: subRoof === 'pagoda' ? 'pagoda' : roof, ridge: d2 >= w2 ? 'z' : 'x', jetty: false, dir: side })
      break
    }
  }
  const cx = Math.floor(w / 2), cz = Math.floor(d / 2)
  const bay = vols.find(v => v.kind === 'bay')
  return {
    form, vols, main, sk: st.sockel, sh: st.storey, ov: st.overhang, cx, cz,
    door: bay ? { x: cx, z: bay.z0 + bay.d - 1 } : { x: cx, z: d - 1 },
    chimney: st.chimneys > 0 && r() > 0.25,
    steep, stoneBase, dormers: false, balcony: false,
    r,
  }
}

/**
 * Plan aus einem Woll-Grundriss: Hauptbau = erstes Rechteck, die anderen werden Anbauten. Kleine Anbauten ein
 * Stockwerk niedriger; ihr First läuft quer zum Hauptbau, damit das Dach in die Kehle läuft.
 */
function footprintPlan(source: BlueprintSource): Plan {
  const p = source.params as unknown as HouseParams
  const st = styleById(p.style)
  const r = rng(source.seed * 7919 + 13)
  const [m, ...rest] = p.footprint!
  const storeys = choose(r, st.storeys[p.size])
  const roof: RoofKind = st.roof === 'gable' && r() < st.hipChance ? 'hip' : st.roof
  const jetty = st.jetty && storeys >= 2 && r() < 0.5
  const main: Vol = { kind: 'main', x0: 0, z0: 0, w: m.w, d: m.d, storeys, roof, ridge: m.d >= m.w ? 'z' : 'x', jetty, jettyAll: false }
  const vols: Vol[] = [main]
  for (const q of rest) {
    const dir: Facing | undefined = q.x0 >= m.w ? 'east' : q.x0 + q.w <= 0 ? 'west' : q.z0 >= m.d ? 'south' : q.z0 + q.d <= 0 ? 'north' : undefined
    const across = dir === 'east' || dir === 'west' ? 'x' : dir ? 'z' : q.d >= q.w ? 'z' : 'x'
    const small = q.w * q.d < (m.w * m.d) / 2
    vols.push({ kind: 'side', x0: q.x0, z0: q.z0, w: q.w, d: q.d, storeys: Math.max(1, small ? storeys - 1 : storeys), roof, ridge: across, jetty: false, dir })
  }
  const inAny = (x: number, z: number) => vols.some(v => x >= v.x0 && x < v.x0 + v.w && z >= v.z0 && z < v.z0 + v.d)
  // Tür an der Südseite des Hauptbaus, möglichst mittig, davor frei
  const cx = Math.floor(m.w / 2), cz = Math.floor(m.d / 2)
  let dx = cx
  for (let off = 0; off < m.w; off++) {
    const cand = [cx + off, cx - off].filter(x => x >= 1 && x <= m.w - 2 && !inAny(x, m.d))
    if (cand.length) {
      dx = cand[0]
      break
    }
  }
  return {
    form: 'rechteck', vols, main, sk: st.sockel, sh: st.storey, ov: st.overhang, cx, cz,
    door: { x: dx, z: m.d - 1 },
    chimney: st.chimneys > 0 && r() > 0.25,
    steep: roof === 'gable' && Math.min(m.w, m.d) <= 9 && r() < st.steepChance,
    stoneBase: storeys >= 2 && r() < st.stoneBaseChance,
    dormers: false, balcony: false,
    r,
  }
}

/** Fläche, für die der Generator Geländehöhen braucht (lokal, relativ zum Anker). */
export function houseGroundExtent(source: BlueprintSource): { x0: number; z0: number; x1: number; z1: number } {
  const pl = plan(source)
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const v of pl.vols) {
    const jx = v.jettyAll ? 1 : 0, jz = v.jetty ? 1 : 0
    x0 = Math.min(x0, v.x0 - jx); z0 = Math.min(z0, v.z0 - jz)
    x1 = Math.max(x1, v.x0 + v.w - 1 + jx); z1 = Math.max(z1, v.z0 + v.d - 1 + jz)
  }
  return { x0: x0 - 3 - pl.cx, z0: z0 - 3 - pl.cz, x1: x1 + 3 - pl.cx, z1: z1 + 6 - pl.cz }
}

export function buildHouse(source: BlueprintSource): Blueprint {
  const p = source.params as unknown as HouseParams
  const st = styleById(p.style)
  const pal = getPalette(p.palette) ?? getPalette(st.palettes[0])!
  const pl = plan(source)
  const { vols, main, sk, sh, ov, cx, cz, r } = pl
  const b = new Builder(pal, source.seed)
  b.anchor = [cx, 0, cz]
  const g: Ground | undefined = p.ground
  const gnd = (x: number, z: number) => Math.max(-10, groundAt(g, x - cx, z - cz))
  const fl = (k: number) => sk - 1 + k * sh
  const top = (v: Vol) => fl(v.storeys)
  const maxK = Math.max(...vols.map(v => v.storeys))
  const timber = st.frame === 'timber' || st.frame === 'posts'

  // ---------- Grundrisse je Stockwerk ----------
  const inVol = (v: Vol, k: number, x: number, z: number) => {
    if (k < 0 || k >= v.storeys) return false
    const j = v.jetty && k >= 1 ? 1 : 0
    const jx = v.jettyAll && k >= 1 ? 1 : 0
    return x >= v.x0 - jx && x < v.x0 + v.w + jx && z >= v.z0 - j && z < v.z0 + v.d + j
  }
  const inF = (k: number, x: number, z: number) => vols.some(v => inVol(v, k, x, z))
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity
  for (const v of vols) {
    bx0 = Math.min(bx0, v.x0 - 1); bz0 = Math.min(bz0, v.z0 - 1)
    bx1 = Math.max(bx1, v.x0 + v.w); bz1 = Math.max(bz1, v.z0 + v.d)
  }
  const cells = (k: number): [number, number][] => {
    const out: [number, number][] = []
    for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) if (inF(k, x, z)) out.push([x, z])
    return out
  }
  const door = pl.door

  // ---------- Fundament: folgt dem Gelände ----------
  const F0 = cells(0)
  const ring = new Map<string, [number, number, Facing]>()
  if (st.skirt)
    for (const [x, z] of F0)
      for (const [f, dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz
        if (inF(0, nx, nz) || (nx === door.x && nz === door.z + 1)) continue
        ring.set(`${nx},${nz}`, [nx, nz, BACK[f]])
      }
  for (const [x, z] of F0) {
    for (let y = gnd(x, z) + 1; y < 0; y++) b.role(x, y, z, 'sockel', {}, 1)
    for (let y = 0; y < fl(0); y++) b.role(x, y, z, 'sockel', {}, 1)
    // Erdgeschoss-Boden und unterste Wandreihe (fehlten bis Fassung 14: die Wände standen auf dem Gelände,
    // im Bauplan fehlte die Ebene zwischen Sockel und Wand)
    const edge = DIRS.some(([, dx, dz]) => !inF(0, x + dx, z + dz))
    if (edge) b.role(x, fl(0), z, 'sockel', {}, 1)
    else b.role(x, fl(0), z, 'floor')
  }
  for (const [x, z, facing] of ring.values()) {
    for (let y = gnd(x, z) + 1; y < 0; y++) b.role(x, y, z, 'sockel', {}, 1)
    b.form(x, 0, z, 'sockel', 'stairs', { facing, half: 'bottom' })
  }

  // ---------- Wände je Stockwerk ----------
  const pillar = new Set<string>()
  const windowAt: { x: number; z: number; k: number; facing: Facing }[] = []
  for (let k = 0; k < maxK; k++) {
    const F = cells(k)
    const isB = (x: number, z: number) => DIRS.some(([, dx, dz]) => !inF(k, x + dx, z + dz))
    // Läufe je Seite: gleiche Außenrichtung, nebeneinander
    for (const [facing, dx, dz] of DIRS) {
      const line = new Map<number, number[]>()
      for (const [x, z] of F) {
        if (inF(k, x + dx, z + dz)) continue
        const key = dx ? x : z
        const along = dx ? z : x
        if (!line.has(key)) line.set(key, [])
        line.get(key)!.push(along)
      }
      for (const [key, list] of line) {
        list.sort((a, c) => a - c)
        const runs: number[][] = []
        for (const a of list) {
          const last = runs[runs.length - 1]
          if (last && a === last[last.length - 1] + 1) last.push(a)
          else runs.push([a])
        }
        for (const run of runs) {
          const a = run[0], e = run[run.length - 1]
          const isDoorRun = k === 0 && facing === 'south' && key === door.z && door.x >= a && door.x <= e
          const pil = new Set([a, e])
          if (timber) for (let i = a + st.spacing; i < e - 1; i += st.spacing) if (!isDoorRun || Math.abs(i - door.x) > 1) pil.add(i)
          if (isDoorRun) { pil.add(door.x - 1); pil.add(door.x + 1) }
          for (const q of pil) pillar.add(`${k},${dx ? key : q},${dx ? q : key}`)
          // Fenster in den Feldern zwischen den Pfosten
          const pts = [...pil].sort((m, n) => m - n)
          if (!timber) for (let i = a + 4; i < e - 2; i += 4) pts.push(i)
          pts.sort((m, n) => m - n)
          for (let i = 0; i < pts.length - 1; i++) {
            const lo = pts[i], hi = pts[i + 1], len = hi - lo - 1
            if (len < 1) continue
            let wins: number[] = []
            if (st.window.wide) wins = Array.from({ length: len }, (_, j) => lo + 1 + j).filter(q => len <= 3 || (q > lo + 1 && q < hi - 1) || st.window.h === 3)
            else if (len >= 3) wins = len % 2 ? [lo + 1 + (len >> 1)] : [lo + len / 2, lo + len / 2 + 1]
            for (const q of wins) {
              const x = dx ? key : q, z = dx ? q : key
              if (isDoorRun && Math.abs(q - door.x) <= 1) continue
              windowAt.push({ x, z, k, facing })
            }
          }
        }
      }
    }
    // Wände, Pfosten
    for (const [x, z] of F) {
      if (!isB(x, z)) continue
      const isPil = pillar.has(`${k},${x},${z}`)
      for (let y = fl(k) + 1; y < fl(k) + sh; y++) {
        if (isPil && (timber || st.frame === 'band')) b.beam(x, y, z, 'frame', 'y')
        else b.role(x, y, z, k === 0 && pl.stoneBase ? 'sockel' : 'wall', {}, sk + 1)
      }
    }
    // Balkenlage über dem Stockwerk, Decke bzw. Boden darüber
    for (const [x, z] of F) {
      const yb = fl(k + 1)
      if (isB(x, z)) {
        const alongX = !inF(k, x, z + 1) || !inF(k, x, z - 1)
        if (st.frame === 'none') b.role(x, yb, z, 'wall')
        else if (pillar.has(`${k},${x},${z}`)) b.beam(x, yb, z, 'frame', 'y')
        else b.beam(x, yb, z, 'frame', alongX ? 'x' : 'z')
      } else {
        const flatTop = !inF(k + 1, x, z) && vols.some(v => inVol(v, k, x, z) && (v.roof === 'flat' || v.roof === 'parapet') && v.storeys === k + 1)
        b.role(x, yb, z, flatTop ? 'roof' : 'floor')
      }
    }
    // Vorkragung: Schwelle und Knaggen darunter
    if (k >= 1)
      for (const [x, z] of F) {
        if (inF(k - 1, x, z)) continue
        const f = DIRS.find(([, dx, dz]) => !inF(k, x + dx, z + dz))?.[0] ?? null
        // Schwelle: bei Stein-Erdgeschoss ein Steinband wie im Vorbild, sonst Balken
        if (pl.stoneBase) b.role(x, fl(k), z, 'sockel', {}, 0)
        else b.beam(x, fl(k), z, 'frame', f === 'east' || f === 'west' ? 'z' : 'x')
        if (f && pillar.has(`${k},${x},${z}`)) b.form(x, fl(k) - 1, z, 'trim', 'stairs', { facing: BACK[f], half: 'top' })
      }
  }

  // ---------- Tür, Stufen, Weg ----------
  const doorId = b.main('door')
  const doubleDoor = st.doubleDoor
  const putDoor = (x: number, hinge: 'left' | 'right') => {
    b.set(x, fl(0) + 1, door.z, `${doorId}[facing=north,half=lower,hinge=${hinge},open=false]`)
    b.set(x, fl(0) + 2, door.z, `${doorId}[facing=north,half=upper,hinge=${hinge},open=false]`)
  }
  putDoor(door.x, 'left')
  if (doubleDoor) {
    // zweiflügelig: der rechte Pfosten wird zur zweiten Tür
    putDoor(door.x + 1, 'right')
    pillar.delete(`0,${door.x + 1},${door.z}`)
  }
  const stepsW = doubleDoor ? [door.x, door.x + 1] : [door.x]
  for (const x of stepsW)
    for (let i = 0; i < sk; i++) {
      const z = door.z + 1 + i
      b.form(x, fl(0) - i, z, 'sockel', 'stairs', { facing: 'north', half: 'bottom' })
      for (let y = fl(0) - i - 1; y >= gnd(x, z); y--) b.role(x, y, z, 'sockel', {}, 1)
    }
  const pathStart = door.z + 1 + sk
  for (let z = pathStart; z < pathStart + 3; z++) for (const x of stepsW) b.role(x, gnd(x, z), z, 'path')

  // ---------- Fenster und Fensterdeko ----------
  const potted = ['potted_poppy', 'potted_dandelion', 'potted_azure_bluet', 'potted_oxeye_daisy', 'potted_red_tulip', 'potted_cornflower', 'potted_allium', 'potted_lily_of_the_valley']
  const windowState = (x: number, y: number, z: number) => {
    const id = b.id('window', x, y, z)
    return st.window.glassBlock && id.endsWith('_pane') ? id.replace('_pane', '') : id
  }
  for (const { x, z, k, facing } of windowAt) {
    if (pillar.has(`${k},${x},${z}`)) continue
    const rows = st.window.h === 1 ? [fl(k) + 2] : st.window.h === 2 ? [fl(k) + 1, fl(k) + 2] : [fl(k) + 1, fl(k) + 2, fl(k) + 3]
    for (const y of rows) b.set(x, y, z, windowState(x, y, z))
    const [ox, oz] = OUT[facing]
    const outX = x + ox, outZ = z + oz
    const nearDoor = k === 0 && facing === 'south' && z === door.z && Math.abs(x - door.x) <= 1
    if (st.window.boxes && !nearDoor && b.noise(x, k, z, 9) < 0.8) {
      b.form(outX, rows[0] - 1, outZ, 'detail', 'trapdoor', { facing, half: 'top', open: 'false' })
      b.set(outX, rows[0], outZ, `minecraft:${potted[Math.floor(b.noise(x, k, z, 3) * potted.length)]}`)
    }
    if (st.window.awning) b.form(outX, rows[rows.length - 1] + 1, outZ, 'detail', 'trapdoor', { facing, half: 'top', open: 'false' })
    if (st.window.shutters) {
      const [sx, sz] = facing === 'south' || facing === 'north' ? [1, 0] : [0, 1]
      for (const s of [-1, 1]) {
        const tx = x + sx * s, tz = z + sz * s
        if (windowAt.some(w => w.k === k && w.x === tx && w.z === tz)) continue
        for (const y of rows) b.soft(tx + ox, y, tz + oz, b.formState('detail', 'trapdoor', { facing, half: 'bottom', open: 'true' }, tx, y, tz))
      }
    }
  }

  // ---------- Dächer: höchstes zuerst, niedrigere laufen hinein ----------
  const roofTop = new Map<string, number>()
  const insideBody = (x: number, y: number, z: number, self: Vol) =>
    vols.some(o => o !== self && y <= top(o) && inVol(o, o.storeys - 1, x, z))
  const put = (self: Vol, x: number, y: number, z: number, place: () => void, surface = true): boolean => {
    if (insideBody(x, y, z, self)) return false
    const t = roofTop.get(`${x},${z}`)
    if (t !== undefined && t >= y) return false
    // Zwerchgiebel über einer tieferen Dachfläche: Lücke darunter schließen
    if (surface && t !== undefined && t < y - 1 && vols.some(o => o !== self && inVol(o, o.storeys - 1, x, z)))
      for (let yy = t + 1; yy < y; yy++) b.role(x, yy, z, 'wall')
    place()
    if (surface) roofTop.set(`${x},${z}`, Math.max(t ?? -999, y))
    return true
  }
  const ridgeY = (v: Vol) => top(v) + (v.roof === 'spire' ? v.w * 2 : v.roof === 'flat' || v.roof === 'parapet' ? 1 : (Math.ceil(Math.min(v.w, v.d) / 2) + ov) * (pl.steep && v.roof === 'gable' ? 2 : 1))
  const order = [...vols].sort((a, c) => ridgeY(c) - ridgeY(a) || (a.kind === 'main' ? -1 : 1))
  for (const v of order) {
    const R = top(v)
    const j = v.jetty && v.storeys >= 2 ? 1 : 0
    const jx = v.jettyAll && v.storeys >= 2 ? 1 : 0
    const fx0 = v.x0 - jx, fz0 = v.z0 - j, fw = v.w + 2 * jx, fd = v.d + 2 * j
    // Flügel laufen ins Hauptdach hinein (Kehle), statt mit einer Giebelwand davor zu enden
    const ext: [number, number] = v.kind === 'main' ? [0, 0] : extendToward(v, main)
    switch (v.roof) {
      case 'gable': gableRoof(b, st, v, fx0, fz0, fw, fd, R, ov, ext, put, v.kind === 'main', () => (pl.steep ? 2 : 1)); break
      case 'gambrel': {
        // Mansard: unteres Drittel bis gut zur Hälfte steil (zwei Stufen je Schritt), darüber flach
        const half = Math.ceil(Math.min(fw, fd) / 2) + ov
        const k = Math.max(2, Math.round(half * 0.45))
        gableRoof(b, st, v, fx0, fz0, fw, fd, R, ov, ext, put, v.kind === 'main', i => (i < k ? 2 : 1))
        break
      }
      case 'halfhip': halfHipRoof(b, st, v, fx0, fz0, fw, fd, R, ov, put); break
      case 'hip': hipRoof(b, v, fx0, fz0, fw, fd, R, ov, false, put); break
      case 'pagoda':
        hipRoof(b, v, fx0, fz0, fw, fd, R, Math.max(2, ov), true, put)
        for (let k = 1; k < v.storeys; k++) skirtRoof(b, v, fx0, fz0, fw, fd, fl(k), put)
        break
      case 'spire': spireRoof(b, v, fx0, fz0, fw, R, put); break
      case 'shed': shedRoof(b, v, R, put); break
      default:
        flatRoof(b, st, v, fx0, fz0, fw, fd, R, ov, put, vols, inVol, top)
        if (v.kind === 'tower' && v.roof === 'parapet') domeRoof(b, v, fx0, fz0, fw, R, put)
    }
  }

  // ---------- Gauben (Wandgauben) auf den langen Seiten des Hauptdachs ----------
  // Wiki „Roof types“, Dormers: „the wall below the dormer is extended upwards and given its own roof section“.
  // Je Seite 1–3 Gauben, 3 breit, Abstand mindestens 2 zum Giebel; ihr Dach läuft quer in die Hauptfläche.
  if (pl.dormers && (main.roof === 'gable' || main.roof === 'gambrel')) {
    const R = top(main)
    const alongZ = main.ridge === 'z'
    const len = alongZ ? main.d : main.w
    const count = Math.max(1, Math.min(3, Math.floor((len - 3) / 5)))
    const step = Math.floor(len / (count + 1))
    const plus: Facing = alongZ ? 'south' : 'east', minus: Facing = alongZ ? 'north' : 'west'
    for (const side of [-1, 1]) {
      // Wandlinie und Richtung nach innen (quer zum First)
      // oberstes Stockwerk kann vorkragen: dann liegt die Wand eine Reihe weiter außen
      const out = alongZ ? (main.jettyAll && main.storeys >= 2 ? 1 : 0) : main.jetty && main.storeys >= 2 ? 1 : 0
      const wallU = side < 0 ? (alongZ ? main.x0 : main.z0) - out : (alongZ ? main.x0 + main.w - 1 : main.z0 + main.d - 1) + out
      const inward = -side
      const at = (u: number, a: number): [number, number] => (alongZ ? [u, a] : [a, u])
      for (let n = 1; n <= count; n++) {
        const c = (alongZ ? main.z0 : main.x0) + n * step
        // Platz frei? (kein Anbau vor dieser Wand)
        if ([-1, 0, 1].some(d => { const [x, z] = at(wallU - inward, c + d); return inF(main.storeys - 1, x, z) })) continue
        let depth = 0
        for (let u = wallU, i = 0; i < 8; u += inward, i++) {
          const [x, z] = at(u, c)
          // bis dorthin, wo die Hauptfläche die Höhe des Gaubendachs erreicht: dort läuft es hinein
          if ((roofTop.get(`${x},${z}`) ?? -99) >= R + 4) break
          depth = i + 1
        }
        if (depth < 2) continue
        for (let i = -1; i <= depth; i++) {
          const u = wallU + inward * i
          for (const d of [-1, 0, 1]) {
            const [x, z] = at(u, c + d)
            if (i >= 0)
              for (let y = R + 1; y <= R + 3; y++) {
                if (i === 0) {
                  // Front: Pfosten außen, Fenster in der Mitte, Sturz darüber
                  if (d === 0) y <= R + 2 ? b.set(x, y, z, windowState(x, y, z)) : b.beam(x, y, z, 'frame', alongZ ? 'z' : 'x')
                  else b.beam(x, y, z, 'frame', 'y')
                } else if (d === 0) b.clear(x, y, z)
                else b.role(x, y, z, 'wall')
              }
            // eigenes kleines Satteldach, First quer zum Hauptdach
            if (d === 0) {
              b.role(x, R + 4, z, 'roof')
              b.form(x, R + 5, z, 'trim', 'slab', { type: 'bottom' })
            } else b.form(x, R + 4, z, i === -1 ? 'trim' : 'roof', 'stairs', { facing: d < 0 ? plus : minus, half: 'bottom' })
          }
        }
      }
    }
  }

  // ---------- Laternen an Ketten unter den Dachecken ----------
  if (st.chainLanterns && (main.roof === 'gable' || main.roof === 'hip' || main.roof === 'pagoda')) {
    const jx = main.jettyAll && main.storeys >= 2 ? 1 : 0, jz = main.jetty && main.storeys >= 2 ? 1 : 0
    const o = main.roof === 'pagoda' ? Math.max(2, ov) : ov
    for (const [x, z] of [[main.x0 - jx - o, main.z0 - jz - o], [main.x0 + main.w - 1 + jx + o, main.z0 - jz - o], [main.x0 - jx - o, main.z0 + main.d - 1 + jz + o], [main.x0 + main.w - 1 + jx + o, main.z0 + main.d - 1 + jz + o]]) {
      // unter der Dachkante: erste belegte Zelle von oben suchen
      let yTop: number | null = null
      for (let y = top(main) + 4; y >= top(main) - 2; y--) if (b.has(x, y, z)) { yTop = y; break }
      if (yTop === null || b.has(x, yTop - 1, z) || b.has(x, yTop - 2, z)) continue
      b.set(x, yTop - 1, z, 'minecraft:iron_chain[axis=y]')
      b.set(x, yTop - 2, z, `${b.main('light')}[hanging=true]`)
    }
  }

  // ---------- Vorbau am Eingang ----------
  const zf = door.z
  const porchY = fl(0) + 3
  const light = b.main('light')
  const outside = (x: number, z: number) => !inF(0, x, z)

  // ---------- Balkon im ersten Stock über der Tür (dient zugleich als Vordach) ----------
  const balcony = pl.balcony && !vols.some(v => v !== main && v.z0 >= main.z0 + main.d)
  if (balcony) {
    const yb = fl(1)
    const xs = [door.x - 1, door.x, door.x + 1 + (doubleDoor ? 1 : 0)]
    for (const x of xs)
      for (const z of [zf + 1, zf + 2]) {
        for (let y = yb + 1; y <= yb + 3; y++) b.clear(x, y, z)
        b.form(x, yb, z, 'floor', 'slab', { type: 'top' })
      }
    for (const x of [xs[0] - 1, ...xs, xs[xs.length - 1] + 1]) b.form(x, yb + 1, zf + 2, 'detail', 'fence')
    for (const x of [xs[0] - 1, xs[xs.length - 1] + 1]) b.form(x, yb + 1, zf + 1, 'detail', 'fence')
    // Knaggen darunter
    for (const x of [xs[0], xs[xs.length - 1]]) b.form(x, yb - 1, zf + 1, 'frame', 'stairs', { facing: 'north', half: 'top' })
    // Tür vom Obergeschoss auf den Balkon
    b.set(door.x, yb + 1, zf, `${doorId}[facing=north,half=lower,hinge=left,open=false]`)
    b.set(door.x, yb + 2, zf, `${doorId}[facing=north,half=upper,hinge=left,open=false]`)
    b.set(xs[0], yb - 1, zf + 2, `${light}[hanging=true]`)
    b.set(xs[xs.length - 1], yb - 1, zf + 2, `${light}[hanging=true]`)
  }
  if (balcony) {
    // Vordach entfällt, der Balkon deckt den Eingang
  } else if (st.porch === 'canopy') {
    for (let x = door.x - 1; x <= door.x + 1 + (doubleDoor ? 1 : 0); x++) b.form(x, porchY, zf + 1, 'roof', 'stairs', { facing: 'north', half: 'bottom' })
    b.form(door.x - 2, porchY, zf + 1, 'roof', 'stairs', { facing: 'east', half: 'bottom' })
    b.form(door.x + 2 + (doubleDoor ? 1 : 0), porchY, zf + 1, 'roof', 'stairs', { facing: 'west', half: 'bottom' })
    b.set(door.x - 1, porchY - 1, zf + 1, `${light}[hanging=true]`)
    b.set(door.x + 1 + (doubleDoor ? 1 : 0), porchY - 1, zf + 1, `${light}[hanging=true]`)
  } else if (st.porch === 'veranda') {
    // umlaufende Veranda (Engawa), zwei Blöcke tief, offen wie im Original
    for (const [x, z] of cells(0))
      for (const [, dx, dz] of DIRS)
        for (const dist of [1, 2]) {
          const nx = x + dx * dist, nz = z + dz * dist
          if (!outside(nx, nz)) continue
          b.soft(nx, fl(0), nz, b.formState('floor', 'slab', { type: 'top' }, nx, fl(0), nz))
        }
    b.set(door.x - 1, fl(0) + 3, zf + 1, `${light}[hanging=true]`)
    b.set(door.x + 1 + (doubleDoor ? 1 : 0), fl(0) + 3, zf + 1, `${light}[hanging=true]`)
  } else if (st.porch === 'slab') {
    for (let z = zf + 1; z <= zf + 2; z++) for (let x = door.x - 2; x <= door.x + 2; x++) b.form(x, porchY, z, 'trim', 'slab', { type: 'bottom' })
    b.set(door.x - 2, porchY - 1, zf + 2, `${light}[hanging=true]`)
    b.set(door.x + 2, porchY - 1, zf + 2, `${light}[hanging=true]`)
  } else {
    // Markise aus Stoff in Streifen auf zwei Pfosten
    const acc = b.palette!.roles.accent.map(a => a.id)
    for (let x = door.x - 2; x <= door.x + 2 + (doubleDoor ? 1 : 0); x++)
      for (const z of [zf + 1, zf + 2]) b.set(x, porchY, z, `minecraft:${acc[Math.abs(x) % acc.length]}`)
    for (const x of [door.x - 2, door.x + 2 + (doubleDoor ? 1 : 0)])
      for (let y = gnd(x, zf + 2) + 1; y < porchY; y++) b.soft(x, y, zf + 2, b.formState('detail', 'fence', {}, x, y, zf + 2))
  }

  // ---------- Deko am Eingang: Bank, Fass, Töpfe ----------
  const benchX = door.x - 2, barrelX = door.x + 2 + (doubleDoor ? 1 : 0)
  const frontZ = zf + 1
  if (outside(benchX, frontZ) && st.porch !== 'veranda') {
    const y = Math.max(gnd(benchX, frontZ) + 1, fl(0) - sk + 1)
    if (st.porch !== 'awning') b.soft(benchX, y, frontZ, b.formState('detail', 'stairs', { facing: 'north', half: 'bottom' }, benchX, y, frontZ))
    else b.soft(benchX, y, frontZ, 'minecraft:potted_dead_bush')
  }
  if (outside(barrelX, frontZ) && st.porch !== 'veranda') {
    const y = Math.max(gnd(barrelX, frontZ) + 1, fl(0) - sk + 1)
    if (st.porch === 'awning') b.soft(barrelX, y, frontZ, 'minecraft:potted_dead_bush')
    else if (st.porch === 'slab') b.soft(barrelX, y, frontZ, `minecraft:${potted[Math.floor(b.noise(1, 2, 3) * potted.length)]}`)
    else {
      b.soft(barrelX, y, frontZ, 'minecraft:barrel[facing=up]')
      b.soft(barrelX, y + 1, frontZ, `minecraft:${potted[Math.floor(b.noise(3, 2, 1) * potted.length)]}`)
    }
  }

  // ---------- Garten vor dem Haus ----------
  const front = cells(0).filter(([x, z]) => outside(x, z + 1))
  // Blumen brauchen Erde; ohne Geländedaten (Vorschau) wird angenommen, dass Gras da ist
  const isSoilAt = (x: number, z: number) => !g?.soil || isSoil(g, x - cx, z - cz)
  for (const [x, z] of front) {
    const bz = z + 1
    if (Math.abs(x - door.x) <= 2 + (doubleDoor ? 1 : 0) || b.has(x, gnd(x, bz) + 1, bz) || b.has(x, 0, bz)) continue
    const y = gnd(x, bz) + 1
    const n = b.noise(x, 0, bz, 21)
    switch (st.garden) {
      case 'hedge': {
        // Busch, darauf oder daneben hohe Blumen (Rosen, Pfingstrosen, Flieder) wie im Vorbild
        const tall = ['rose_bush', 'peony', 'lilac'][Math.floor(b.noise(x, 3, bz, 23) * 3)]
        if (n < 0.45) b.soft(x, y, bz, n < 0.2 ? 'minecraft:flowering_azalea_leaves[persistent=true]' : 'minecraft:oak_leaves[persistent=true]')
        else if (isSoilAt(x, bz)) {
          b.soft(x, y, bz, `minecraft:${tall}[half=lower]`)
          b.soft(x, y + 1, bz, `minecraft:${tall}[half=upper]`)
        } else b.soft(x, y, bz, 'minecraft:oak_leaves[persistent=true]')
        if (n > 0.92) b.soft(x, y, bz + 1, 'minecraft:hay_block[axis=y]')
        break
      }
      case 'gravel':
        b.set(x, y - 1, bz, 'minecraft:gravel')
        if (n < 0.2) b.soft(x, y, bz, 'minecraft:azalea_leaves[persistent=true]')
        break
      case 'planter':
        if (x % 2 === 0) b.soft(x, y, bz, 'minecraft:potted_azalea_bush')
        break
      case 'pots':
        if (n < 0.35) b.soft(x, y, bz, 'minecraft:potted_dead_bush')
        else if (n < 0.5) b.soft(x, y, bz, 'minecraft:potted_cactus')
        break
      case 'yard':
        if (n < 0.25) b.soft(x, y, bz, 'minecraft:barrel[facing=up]')
        else if (n < 0.4) b.soft(x, y, bz, 'minecraft:composter[level=0]')
        break
    }
  }
  // Laternen am Weg
  if (st.porch === 'canopy' || st.garden === 'gravel') {
    const z = pathStart + 2
    for (const x of [door.x - 1, door.x + 1 + (doubleDoor ? 1 : 0)]) {
      if (b.has(x, gnd(x, z) + 1, z)) continue
      const y0 = gnd(x, z) + 1
      if (st.garden === 'gravel') {
        b.role(x, y0, z, 'sockel', {}, 0)
        b.form(x, y0 + 1, z, 'sockel', 'slab', { type: 'top' })
        b.set(x, y0 + 2, z, `${light}[hanging=false]`)
      } else {
        b.set(x, y0, z, b.formState('detail', 'fence', {}, x, y0, z))
        b.set(x, y0 + 1, z, `${light}[hanging=false]`)
      }
    }
  }

  // ---------- Balkenköpfe und Efeu ----------
  if (st.beamEnds)
    for (let k = 0; k < maxK; k++)
      for (const [x, z] of cells(k)) {
        if (!pillar.has(`${k},${x},${z}`)) continue
        for (const [, dx, dz] of DIRS) {
          if (inF(k, x + dx, z + dz) || inF(k + 1, x + dx, z + dz)) continue
          // nur in der Mitte einer Wand, nicht an Ecken
          if (!inF(k, x - dz, z - dx) || !inF(k, x + dz, z + dx)) continue
          b.soft(x + dx, fl(k + 1), z + dz, b.beamState('frame', dx ? 'x' : 'z', x, fl(k + 1), z))
        }
      }
  if (st.ivy)
    for (const [x, z] of cells(0))
      for (const [f, dx, dz] of DIRS) {
        if (inF(0, x + dx, z + dz) || b.noise(x, 7, z, 31) > 0.16) continue
        const prop = BACK[f]
        const hgt = 2 + Math.floor(b.noise(z, 1, x, 5) * 3)
        for (let y = fl(0) + sh - 1; y > fl(0) + sh - 1 - hgt; y--) {
          const tx = x + dx, tz = z + dz
          const wall = b.get(x, y, z)
          if (!wall || b.has(tx, y, tz) || /glass|door|trapdoor/.test(wall)) break
          b.set(tx, y, tz, `minecraft:vine[${prop}=true]`)
        }
      }

  // ---------- Innen: Leiter, Licht ----------
  for (let k = 0; k < main.storeys - 1; k++)
    for (let y = fl(k) + 1; y <= fl(k + 1); y++) b.set(1, y, 1, 'minecraft:ladder[facing=south]')
  for (const v of vols)
    for (let k = 0; k < v.storeys; k++) {
      const lx = v.x0 + Math.floor(v.w / 2), lz = v.z0 + Math.floor(v.d / 2)
      if (!b.has(lx, fl(k) + sh - 1, lz)) b.set(lx, fl(k) + sh - 1, lz, `${light}[hanging=true]`)
    }

  // ---------- Schornstein ----------
  if (pl.chimney && (main.roof === 'gable' || main.roof === 'hip')) {
    const along = main.ridge === 'z'
    const x = along ? (r() < 0.5 ? 1 : main.w - 2) : (r() < 0.5 ? 1 : main.w - 2)
    const z = along ? (r() < 0.5 ? 1 : main.d - 2) : 1
    if (!(x === 1 && z === 1)) {
      let t = top(main)
      for (let y = top(main); y < top(main) + main.w + main.d; y++) if (b.has(x, y, z)) t = y
      for (let y = fl(0) + 1; y <= t + 1; y++) b.role(x, y, z, 'sockel', {}, 0)
      // Lagerfeuer oben: der Rauch steigt wie aus einem echten Kamin
      b.set(x, t + 2, z, 'minecraft:campfire[lit=true,signal_fire=false]')
    }
  }
  // Blitzableiter oder Wetterfahne auf dem Turm
  const tower = vols.find(v => v.kind === 'tower')
  if (tower && st.id === 'steampunk') {
    const tx = tower.x0 + (tower.w >> 1), tz = tower.z0 + (tower.d >> 1)
    let t = top(tower)
    for (let y = t; y < t + 40; y++) if (b.has(tx, y, tz)) t = y
    b.set(tx, t + 1, tz, 'minecraft:lightning_rod[facing=up]')
  }

  return b.toBlueprint(`${st.label}es Haus`, source)
}

/** Wie weit ein Flügel sein Dach in Richtung Hauptbau verlängert (Kehle): [Anfang, Ende] entlang des Firsts. */
function extendToward(v: Vol, main: Vol): [number, number] {
  const reach = Math.max(main.w, main.d)
  switch (v.dir) {
    case 'east': return v.ridge === 'x' ? [reach, 0] : [0, 0]
    case 'west': return v.ridge === 'x' ? [0, reach] : [0, 0]
    case 'south': return v.ridge === 'z' ? [reach, 0] : [0, 0]
    case 'north': return v.ridge === 'z' ? [0, reach] : [0, 0]
    default: return [0, 0]
  }
}

type Put = (self: Vol, x: number, y: number, z: number, place: () => void, surface?: boolean) => boolean

// ---------- Dächer ----------

/** Steigung je Schritt nach innen: 1 normal, 2 steil; Mansard unten steil, oben flach */
type Rise = (i: number) => number

function gableRoof(b: Builder, st: Style, v: Vol, fx0: number, fz0: number, fw: number, fd: number, R: number, ov: number, ext: [number, number], put: Put, isMain: boolean, riseAt: Rise): void {
  const alongZ = v.ridge === 'z'
  const U = alongZ ? fw : fd, V = alongZ ? fd : fw
  const u0 = alongZ ? fx0 : fz0, v0 = alongZ ? fz0 : fx0
  const xz = (u: number, vv: number): [number, number] => (alongZ ? [u0 + u, v0 + vv] : [v0 + vv, u0 + u])
  const up: Facing = alongZ ? 'east' : 'south'
  const down: Facing = alongZ ? 'west' : 'north'
  const vLo = -1 - ext[0], vHi = V + ext[1]
  // steil: je Schritt nach innen zwei Stufen übereinander (wie im Vorbild „55 Tricks“)
  let y = R - ov + 1
  for (let i = 0; ; i++) {
    const rise = riseAt(i)
    if (i > 0) y += riseAt(i - 1)
    const left = -ov + i, right = U - 1 + ov - i
    if (left > right) break
    for (let vv = vLo; vv <= vHi; vv++) {
      // Kantenholz an Traufe nur beim Hauptdach; Nebendächer bleiben im Dachmaterial, sonst wirkt die Kehle unruhig
      const edge = (i === 0 && isMain) || (vv === -1 && ext[0] === 0) || (vv === V && ext[1] === 0)
      const role: Role = edge ? 'trim' : 'roof'
      const [lx, lz] = xz(left, vv), [rx, rz] = xz(right, vv)
      for (let s = 0; s < rise; s++) {
        const yy = y + s
        if (left === right) {
          if (s === rise - 1) put(v, lx, yy, lz, () => b.form(lx, yy, lz, 'trim', 'slab', { type: 'bottom' }))
          else put(v, lx, yy, lz, () => b.role(lx, yy, lz, 'trim'))
        } else {
          put(v, lx, yy, lz, () => b.form(lx, yy, lz, role, 'stairs', { facing: up, half: 'bottom' }))
          put(v, rx, yy, rz, () => b.form(rx, yy, rz, role, 'stairs', { facing: down, half: 'bottom' }))
        }
      }
      // Untersicht unter dem Überstand: umgedrehte Stufen
      if (i === 0 && st.soffit && isMain && vv >= 0 && vv < V) {
        put(v, lx, y - 1, lz, () => b.form(lx, y - 1, lz, 'trim', 'stairs', { facing: down, half: 'top' }), false)
        put(v, rx, y - 1, rz, () => b.form(rx, y - 1, rz, 'trim', 'stairs', { facing: up, half: 'top' }), false)
      }
    }
    // Giebelwände unter den Dachflächen (nur an freien Enden)
    for (let s = 0; s < rise; s++) {
      const yy = y + s
      if (yy <= R) continue
      const ends = [...(ext[0] === 0 ? [0] : []), ...(ext[1] === 0 ? [V - 1] : [])]
      for (let u = Math.max(0, left + 1); u <= Math.min(U - 1, right - 1); u++)
        for (const vv of ends) {
          const [x, z] = xz(u, vv)
          const center = u === Math.floor((U - 1) / 2)
          const gableWindow = center && (yy === R + 2 || (rise > 1 && yy === R + 3)) && right - left >= 5
          put(v, x, yy, z, () => {
            if (gableWindow) b.role(x, yy, z, 'window')
            else if (st.frame === 'timber' && (u === 0 || u === U - 1 || center)) b.role(x, yy, z, 'frame', { axis: 'y' })
            else b.role(x, yy, z, 'wall')
          }, false)
        }
    }
  }
}

/**
 * Krüppelwalm: unten Satteldach mit Giebelwänden, das obere Stück walmt an beiden Enden ab.
 * Wiki „Roof types“: „Half-hipped roof … gable roof for part of the height, then hipped for the remainder“.
 */
function halfHipRoof(b: Builder, st: Style, v: Vol, fx0: number, fz0: number, fw: number, fd: number, R: number, ov: number, put: Put): void {
  const alongZ = v.ridge === 'z'
  const U = alongZ ? fw : fd, V = alongZ ? fd : fw
  const u0 = alongZ ? fx0 : fz0, v0 = alongZ ? fz0 : fx0
  const xz = (u: number, vv: number): [number, number] => (alongZ ? [u0 + u, v0 + vv] : [v0 + vv, u0 + u])
  const upU: Facing = alongZ ? 'east' : 'south', downU: Facing = alongZ ? 'west' : 'north'
  const upV: Facing = alongZ ? 'south' : 'east', downV: Facing = alongZ ? 'north' : 'west'
  const half = Math.ceil(U / 2) + ov
  const k = Math.max(2, Math.round(half * 0.55)) // so viele Reihen Satteldach, dann Walm
  for (let i = 0; ; i++) {
    const left = -ov + i, right = U - 1 + ov - i
    if (left > right) break
    const y = R - ov + 1 + i
    const inset = Math.max(0, i - k + 1)
    const vLo = -1 + inset, vHi = V + inset * -1
    for (let vv = vLo; vv <= vHi; vv++)
      for (let u = left; u <= right; u++) {
        const sideU = u === left || u === right
        const endV = i >= k && (vv === vLo || vv === vHi)
        if (!sideU && !endV) continue
        const [x, z] = xz(u, vv)
        const role: Role = i === 0 ? 'trim' : 'roof'
        if (left === right || (endV && vLo === vHi)) put(v, x, y, z, () => b.form(x, y, z, 'trim', 'slab', { type: 'bottom' }))
        else if (sideU) put(v, x, y, z, () => b.form(x, y, z, role, 'stairs', { facing: u === left ? upU : downU, half: 'bottom' }))
        else put(v, x, y, z, () => b.form(x, y, z, role, 'stairs', { facing: vv === vLo ? upV : downV, half: 'bottom' }))
      }
    // Giebelwand unter dem Satteldach-Teil
    if (i < k && y > R)
      for (let u = Math.max(0, left + 1); u <= Math.min(U - 1, right - 1); u++)
        for (const vv of [0, V - 1]) {
          const [x, z] = xz(u, vv)
          const center = u === Math.floor((U - 1) / 2)
          put(v, x, y, z, () => {
            if (center && y === R + 2 && right - left >= 5) b.role(x, y, z, 'window')
            else if (st.frame === 'timber' && (u === 0 || u === U - 1 || center)) b.role(x, y, z, 'frame', { axis: 'y' })
            else b.role(x, y, z, 'wall')
          }, false)
        }
  }
}

function hipRoof(b: Builder, v: Vol, fx0: number, fz0: number, fw: number, fd: number, R: number, ov: number, pagoda: boolean, put: Put): void {
  for (let i = 0; ; i++) {
    const x0 = fx0 - ov + i, x1 = fx0 + fw - 1 + ov - i, z0 = fz0 - ov + i, z1 = fz0 + fd - 1 + ov - i
    if (x0 > x1 || z0 > z1) break
    // Pagode: außen zwei flache Stufen (Traufe), danach steil – ergibt den geschwungenen Umriss
    // Pagode: außen flache Traufe, dann halbe Steigung (Stufen abwechselnd unten/oben) – breit und flach wie im Original
    const y = pagoda ? R + Math.floor(Math.max(0, i - 1) / 2) : R - ov + 1 + i
    const half = pagoda ? (i >= 1 && (i - 1) % 2 === 1 ? 'top' : 'bottom') : 'bottom'
    const line = x0 === x1 || z0 === z1
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1)
        if (line) {
          put(v, x, y, z, () => b.form(x, y, z, pagoda ? 'trim' : 'roof', 'slab', { type: 'bottom' }))
          continue
        }
        if (pagoda) {
          put(v, x, y, z, () => {
            if (i === 0 && corner) b.form(x, y, z, 'trim', 'slab', { type: 'top' })
            else b.form(x, y, z, i === 0 ? 'trim' : 'roof', 'slab', { type: half })
          })
          // unter der oberen Stufe auffüllen, damit das Dach dicht wirkt
          if (half === 'top' && i > 2) put(v, x, y - 1, z, () => b.role(x, y - 1, z, 'roof'), false)
          continue
        }
        const facing: Facing = z === z0 ? 'south' : z === z1 ? 'north' : x === x0 ? 'east' : 'west'
        put(v, x, y, z, () => b.form(x, y, z, i === 0 ? 'trim' : 'roof', 'stairs', { facing, half: 'bottom' }))
      }
    if (pagoda && i === 0)
      // aufgebogene Ecken
      for (const [x, z] of [[x0 - 1, z0 - 1], [x1 + 1, z0 - 1], [x0 - 1, z1 + 1], [x1 + 1, z1 + 1]])
        put(v, x, y, z, () => b.form(x, y, z, 'trim', 'slab', { type: 'top' }))
  }
}

/** Kleines Pultdach-Band zwischen den Stockwerken (Pagoden-Stufe). */
function skirtRoof(b: Builder, v: Vol, fx0: number, fz0: number, fw: number, fd: number, y: number, put: Put): void {
  for (const dist of [1, 2])
    for (let z = fz0 - dist; z <= fz0 + fd - 1 + dist; z++)
      for (let x = fx0 - dist; x <= fx0 + fw - 1 + dist; x++) {
        if (x > fx0 - dist && x < fx0 + fw - 1 + dist && z > fz0 - dist && z < fz0 + fd - 1 + dist) continue
        put(v, x, y, z, () => b.form(x, y, z, dist === 1 ? 'roof' : 'trim', 'slab', { type: dist === 1 ? 'top' : 'bottom' }), false)
      }
}

/** Spitzhelm für Türme: je Ring zwei Stufen übereinander, also doppelt so steil wie ein normales Dach. */
function spireRoof(b: Builder, v: Vol, fx0: number, fz0: number, fw: number, R: number, put: Put): void {
  const c0 = fx0 + (fw >> 1), c1 = fz0 + (fw >> 1)
  const rings = (fw >> 1) + 1
  for (let i = 0; i <= rings; i++) {
    const rr = rings - i
    const y = R + 2 * i
    for (let z = c1 - rr; z <= c1 + rr; z++)
      for (let x = c0 - rr; x <= c0 + rr; x++) {
        if (Math.abs(x - c0) !== rr && Math.abs(z - c1) !== rr) continue
        if (rr === 0) {
          put(v, x, y, z, () => b.role(x, y, z, 'roof'))
          put(v, x, y + 1, z, () => b.form(x, y + 1, z, 'detail', 'fence'))
          continue
        }
        const facing: Facing = z === c1 - rr ? 'south' : z === c1 + rr ? 'north' : x === c0 - rr ? 'east' : 'west'
        put(v, x, y, z, () => b.form(x, y, z, i === 0 ? 'trim' : 'roof', 'stairs', { facing, half: 'bottom' }))
        if (i > 0) put(v, x, y + 1, z, () => b.form(x, y + 1, z, 'roof', 'stairs', { facing, half: 'bottom' }))
      }
    // unter dem nächsten Ring füllen, damit zwischen den Stufen kein Loch bleibt
    if (rr > 1)
      for (let z = c1 - rr + 1; z <= c1 + rr - 1; z++)
        for (let x = c0 - rr + 1; x <= c0 + rr - 1; x++)
          if (Math.abs(x - c0) === rr - 1 || Math.abs(z - c1) === rr - 1) put(v, x, y + 1, z, () => b.role(x, y + 1, z, 'roof'), false)
  }
}

/** Kuppel für Wüstentürme: Ringe aus Stufen, oben flach mit Spitze. */
function domeRoof(b: Builder, v: Vol, fx0: number, fz0: number, fw: number, R: number, put: Put): void {
  const c0 = fx0 + (fw >> 1), c1 = fz0 + (fw >> 1)
  const rad = fw >> 1
  // Profil einer Viertelkugel: je Höhenstufe der Radius
  const prof = Array.from({ length: rad + 1 }, (_, i) => Math.round(Math.sqrt(Math.max(0, (rad + 0.5) ** 2 - (i * 1.15) ** 2))))
  prof.forEach((rr, i) => {
    const y = R + 1 + i
    const next = prof[i + 1] ?? -1
    for (let z = c1 - rr; z <= c1 + rr; z++)
      for (let x = c0 - rr; x <= c0 + rr; x++) {
        const dd = Math.max(Math.abs(x - c0), Math.abs(z - c1))
        if (dd > rr || (dd <= next && rr > 0)) continue
        const facing: Facing = z === c1 - rr ? 'south' : z === c1 + rr ? 'north' : x === c0 - rr ? 'east' : 'west'
        put(v, x, y, z, () => (dd === rr && rr > 0 && rr - next >= 1 ? b.form(x, y, z, 'roof', 'stairs', { facing, half: 'bottom' }) : b.role(x, y, z, 'roof')))
      }
  })
  put(v, c0, R + 2 + rad, c1, () => b.form(c0, R + 2 + rad, c1, 'trim', 'slab', { type: 'bottom' }))
}

/** Pultdach aus Stufen-Blöcken: flach ansteigend zur Wand des Hauptbaus. */
function shedRoof(b: Builder, v: Vol, R: number, put: Put): void {
  const outDir = v.dir ?? 'east'
  const [ox] = OUT[outDir]
  const n = v.w + 1
  for (let i = 0; i <= n; i++) {
    // i = 0 an der Traufe außen, zur Wand hin höher
    const x = ox > 0 ? v.x0 + v.w - i : v.x0 - 1 + i
    const half = i % 2 === 0 ? 'bottom' : 'top'
    const y = R + Math.floor(i / 2)
    for (let z = v.z0 - 1; z <= v.z0 + v.d; z++) {
      const edge = i === 0 || z === v.z0 - 1 || z === v.z0 + v.d
      put(v, x, y, z, () => b.form(x, y, z, edge ? 'trim' : 'roof', 'slab', { type: half }))
    }
  }
}

function flatRoof(
  b: Builder, st: Style, v: Vol, fx0: number, fz0: number, fw: number, fd: number, R: number, ov: number, put: Put,
  vols: Vol[], inVol: (v: Vol, k: number, x: number, z: number) => boolean, top: (v: Vol) => number,
): void {
  const perim: [number, number][] = []
  for (let x = fx0; x < fx0 + fw; x++) perim.push([x, fz0], [x, fz0 + fd - 1])
  for (let z = fz0 + 1; z < fz0 + fd - 1; z++) perim.push([fx0, z], [fx0 + fw - 1, z])
  // Dachterrasse: grenzt ein höherer Teil an, bekommt die Fläche ein Geländer statt einer Kante
  const terrace = vols.some(o => o !== v && top(o) > R)
  if (v.roof === 'flat') {
    for (let dist = 1; dist <= ov; dist++)
      for (let z = fz0 - dist; z <= fz0 + fd - 1 + dist; z++)
        for (let x = fx0 - dist; x <= fx0 + fw - 1 + dist; x++) {
          if (x > fx0 - dist && x < fx0 + fw - 1 + dist && z > fz0 - dist && z < fz0 + fd - 1 + dist) continue
          put(v, x, R, z, () => b.form(x, R, z, 'trim', 'slab', { type: 'top' }))
        }
    for (const [x, z] of perim) {
      if (vols.some(o => o !== v && inVol(o, o.storeys - 1, x, z) && top(o) > R)) continue
      put(v, x, R + 1, z, () => (terrace ? b.set(x, R + 1, z, 'minecraft:glass_pane') : b.form(x, R + 1, z, 'trim', 'slab', { type: 'bottom' })))
    }
    return
  }
  // niedrige Brüstung mit Abdeckung, darunter ein Gesims (Wüste)
  for (const [x, z] of perim) {
    if (vols.some(o => o !== v && inVol(o, o.storeys - 1, x, z) && top(o) > R)) continue
    put(v, x, R + 1, z, () => b.form(x, R + 1, z, 'trim', 'slab', { type: 'bottom' }))
  }
  const ring: [number, number, Facing][] = []
  for (let x = fx0; x < fx0 + fw; x++) ring.push([x, fz0 - 1, 'south'], [x, fz0 + fd, 'north'])
  for (let z = fz0; z < fz0 + fd; z++) ring.push([fx0 - 1, z, 'east'], [fx0 + fw, z, 'west'])
  for (const [x, z, f] of ring) put(v, x, R, z, () => b.form(x, R, z, 'trim', 'stairs', { facing: f, half: 'top' }), false)
  if (st.vigas) {
    for (let x = fx0 + 2; x < fx0 + fw - 2; x += 2) {
      b.soft(x, R - 1, fz0 - 1, b.beamState('frame', 'z', x, R - 1, fz0 - 1))
      b.soft(x, R - 1, fz0 + fd, b.beamState('frame', 'z', x, R - 1, fz0 + fd))
    }
    for (let z = fz0 + 2; z < fz0 + fd - 2; z += 2) {
      b.soft(fx0 - 1, R - 1, z, b.beamState('frame', 'x', fx0 - 1, R - 1, z))
      b.soft(fx0 + fw, R - 1, z, b.beamState('frame', 'x', fx0 + fw, R - 1, z))
    }
  }
}
