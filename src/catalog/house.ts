// Haus-Generator: Grundform + Dach + Module, alles aus Stil und Palette.
// Lokale Koordinaten: Grundfläche x 0…w-1, z 0…d-1, Eingang an der Südseite (z = d-1).
// y = 0 ist die Höhe des Geländeblocks am Anker; der Sockel folgt dem Gelände nach unten.

import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { Builder, choose, groundAt, rng, type Facing, type Ground } from '../style/builder'
import { getPalette, type Role } from '../style/palettes'
import { styleById, type Size, type Style } from './styles'

export interface HouseParams {
  style: string
  palette: string
  size: Size
  ground?: Ground
}

interface Dims {
  w: number
  d: number
  storeys: number
  r: () => number
}

function dims(source: BlueprintSource): Dims {
  const p = source.params as unknown as HouseParams
  const st = styleById(p.style)
  const r = rng(source.seed * 7919 + 13)
  const [w, d] = choose(r, st.sizes[p.size])
  const storeys = choose(r, st.storeys[p.size])
  return { w, d, storeys, r }
}

/** Fläche, für die der Generator Geländehöhen braucht (lokal, relativ zum Anker). */
export function houseGroundExtent(source: BlueprintSource): { x0: number; z0: number; x1: number; z1: number } {
  const { w, d } = dims(source)
  const cx = Math.floor(w / 2), cz = Math.floor(d / 2)
  return { x0: -2 - cx, z0: -2 - cz, x1: w + 1 - cx, z1: d + 4 - cz }
}

const OUT: Record<Facing, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }

export function buildHouse(source: BlueprintSource): Blueprint {
  const p = source.params as unknown as HouseParams
  const st = styleById(p.style)
  const pal = getPalette(p.palette) ?? getPalette(st.palettes[0])!
  const { w, d, storeys, r } = dims(source)
  const b = new Builder(pal, source.seed)
  const cx = Math.floor(w / 2), cz = Math.floor(d / 2)
  // Generator rechnet in Koordinaten relativ zur Ecke; der Anker ist die Mitte am Boden.
  b.anchor = [cx, 0, cz]
  const g: Ground | undefined = p.ground
  const gnd = (x: number, z: number) => groundAt(g, x - cx, z - cz)

  const sk = st.sockel
  const sh = st.storey
  const fl = (k: number) => sk - 1 + k * sh
  const R = fl(storeys)
  const timber = st.frame === 'timber' || st.frame === 'posts'

  // ---------- Pfosten ----------
  const pillars = (len: number): number[] => {
    const s = new Set([0, len - 1])
    if (timber) for (let i = st.spacing; i < len - 1; i += st.spacing) if (len - 1 - i >= 2) { s.add(i); s.add(len - 1 - i) }
    return [...s].sort((a, b) => a - b)
  }
  const px = pillars(w), pz = pillars(d)
  // Eingang: Türpfosten links und rechts der Mitte statt eines Pfostens in der Mitte
  const frontPillars = [...new Set([...px.filter(x => x !== cx), cx - 1, cx + 1])].sort((a, b) => a - b)

  type Side = { facing: Facing; cells: [number, number][]; along: 'x' | 'z'; pillarsAt: (k: number) => number[] }
  const sides: Side[] = [
    { facing: 'south', along: 'x', cells: range(w).map(x => [x, d - 1]), pillarsAt: k => (k === 0 ? frontPillars : px) },
    { facing: 'north', along: 'x', cells: range(w).map(x => [x, 0]), pillarsAt: () => px },
    { facing: 'west', along: 'z', cells: range(d).map(z => [0, z]), pillarsAt: () => pz },
    { facing: 'east', along: 'z', cells: range(d).map(z => [w - 1, z]), pillarsAt: () => pz },
  ]
  const onPerimeter = (x: number, z: number) => x === 0 || z === 0 || x === w - 1 || z === d - 1
  const isCorner = (x: number, z: number) => (x === 0 || x === w - 1) && (z === 0 || z === d - 1)

  // ---------- Fundament: folgt dem Gelände ----------
  for (let z = -1; z <= d; z++)
    for (let x = -1; x <= w; x++) {
      const inside = x >= 0 && z >= 0 && x < w && z < d
      if (!inside && !st.skirt) continue
      const gy = Math.max(-10, gnd(x, z))
      for (let y = gy + 1; y < 0; y++) b.role(x, y, z, 'sockel', {}, 1)
    }
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < sk - 1; y++) b.role(x, y, z, 'sockel', {}, 1)
      b.role(x, fl(0), z, onPerimeter(x, z) ? 'sockel' : 'floor', {}, 1)
    }
  if (sk > 1) for (const [x, z] of perimeter(w, d)) for (let y = 0; y < sk; y++) b.role(x, y, z, 'sockel', {}, 1)
  if (st.skirt) {
    for (let x = -1; x <= w; x++) {
      skirt(x, -1, 'south')
      if (x !== cx) skirt(x, d, 'north')
    }
    for (let z = 0; z < d; z++) {
      skirt(-1, z, 'east')
      skirt(w, z, 'west')
    }
  }
  function skirt(x: number, z: number, facing: Facing) {
    b.form(x, 0, z, 'sockel', 'stairs', { facing, half: 'bottom' })
  }

  // ---------- Wände, Balken, Böden ----------
  for (let k = 0; k < storeys; k++) {
    for (const side of sides) {
      const pil = new Set(side.pillarsAt(k))
      for (const [x, z] of side.cells) {
        const along = side.along === 'x' ? x : z
        for (let y = fl(k) + 1; y < fl(k) + sh; y++) {
          if (isCorner(x, z) && st.frame === 'band') b.role(x, y, z, 'frame', { axis: 'y' })
          else if (timber && pil.has(along)) b.beam(x, y, z, 'frame', 'y')
          else b.role(x, y, z, 'wall', {}, sk + 1)
        }
        // Balkenlage über dem Stockwerk
        const yb = fl(k + 1)
        if (st.frame === 'none') b.role(x, yb, z, 'wall')
        else if (isCorner(x, z)) b.beam(x, yb, z, 'frame', 'y')
        else b.beam(x, yb, z, 'frame', side.along)
      }
    }
    // Boden des nächsten Stockwerks bzw. Decke
    for (let z = 1; z < d - 1; z++) for (let x = 1; x < w - 1; x++) b.role(x, fl(k + 1), z, st.roof === 'flat' || st.roof === 'parapet' ? (k === storeys - 1 ? 'roof' : 'floor') : 'floor')
  }

  // ---------- Tür und Stufen ----------
  const doorId = b.main('door')
  b.set(cx, fl(0) + 1, d - 1, `${doorId}[facing=north,half=lower,hinge=left,open=false]`)
  b.set(cx, fl(0) + 2, d - 1, `${doorId}[facing=north,half=upper,hinge=left,open=false]`)
  for (let i = 0; i < sk; i++) {
    b.form(cx, fl(0) - i, d + i, 'sockel', 'stairs', { facing: 'north', half: 'bottom' })
    // nur bis zum Geländeblock auffüllen, nie darunter (sonst müsste man im Spiel Erde tauschen)
    for (let y = fl(0) - i - 1; y >= Math.max(-10, gnd(cx, d + i)); y--) b.role(cx, y, d + i, 'sockel', {}, 1)
  }
  // Weg vom Eingang
  for (let i = sk; i < sk + 3; i++) {
    const z = d + i
    b.role(cx, gnd(cx, z), z, 'path')
  }

  // ---------- Fenster ----------
  const potted = ['potted_poppy', 'potted_dandelion', 'potted_azure_bluet', 'potted_oxeye_daisy', 'potted_red_tulip', 'potted_cornflower', 'potted_allium']
  const windowState = (x: number, y: number, z: number) => {
    const id = b.id('window', x, y, z)
    return st.window.glassBlock && id.endsWith('_pane') ? id.replace('_pane', '') : id
  }
  for (let k = 0; k < storeys; k++) {
    const rows = st.window.h === 1 ? [fl(k) + 2] : st.window.h === 2 ? [fl(k) + 1, fl(k) + 2] : [fl(k) + 1, fl(k) + 2, fl(k) + 3]
    for (const side of sides) {
      const pil = side.pillarsAt(k)
      const [ox, oz] = OUT[side.facing]
      const segs = segments(pil, side.along === 'x' ? w : d, st.frame === 'timber' || st.frame === 'posts' ? 0 : 4)
      for (const [a, bnd] of segs) {
        const len = bnd - a - 1
        let cells: number[] = []
        if (st.window.wide) cells = range(len).map(i => a + 1 + i).filter(i => len <= 3 || (i > a + 1 && i < bnd - 1) || st.window.h === 3)
        else if (len >= 3) cells = len % 2 ? [a + 1 + (len >> 1)] : [a + len / 2, a + len / 2 + 1]
        for (const along of cells) {
          const x = side.along === 'x' ? along : side.cells[0][0]
          const z = side.along === 'z' ? along : side.cells[0][1]
          if (k === 0 && side.facing === 'south' && x === cx) continue
          for (const y of rows) b.set(x, y, z, windowState(x, y, z))
          const outX = x + ox, outZ = z + oz
          if (st.window.boxes && !(side.facing === 'south' && k === 0 && Math.abs(x - cx) <= 1)) {
            b.form(outX, rows[0] - 1, outZ, 'detail', 'trapdoor', { facing: side.facing, half: 'top', open: 'false' })
            b.set(outX, rows[0], outZ, `minecraft:${potted[Math.floor(b.noise(x, k, z, 3) * potted.length)]}`)
          }
          if (st.window.awning) b.form(outX, rows[rows.length - 1] + 1, outZ, 'detail', 'trapdoor', { facing: side.facing, half: 'top', open: 'false' })
        }
        if (st.window.shutters && cells.length) {
          for (const along of [cells[0] - 1, cells[cells.length - 1] + 1]) {
            if (along <= a || along >= bnd) continue
            const x = side.along === 'x' ? along : side.cells[0][0]
            const z = side.along === 'z' ? along : side.cells[0][1]
            if (k === 0 && side.facing === 'south' && Math.abs(x - cx) <= 0) continue
            for (const y of rows) b.form(x + ox, y, z + oz, 'detail', 'trapdoor', { facing: side.facing, half: 'bottom', open: 'true' })
          }
        }
      }
    }
  }

  // ---------- Dach ----------
  const ov = st.overhang
  if (st.roof === 'gable') gableRoof(b, w, d, R, ov, st)
  else if (st.roof === 'hip') hipRoof(b, w, d, R, ov, false)
  else if (st.roof === 'pagoda') {
    hipRoof(b, w, d, R, ov, true)
    for (let k = 1; k < storeys; k++) skirtRoof(b, w, d, fl(k))
  } else flatRoof(b, w, d, R, ov, st)

  // ---------- Veranda (japanisch) ----------
  if (st.veranda) for (let x = -1; x <= w; x++) if (x !== cx) b.form(x, fl(0), d, 'detail', 'slab', { type: 'top' })

  // ---------- Vordach mit Laternen ----------
  const porchY = fl(0) + 3
  if (st.roof !== 'pagoda') {
    // untere Stufe: ihre Unterseite ist voll, daran halten hängende Laternen
    for (let x = cx - 1; x <= cx + 1; x++) b.form(x, porchY, d, st.roof === 'flat' ? 'trim' : 'roof', 'slab', { type: 'bottom' })
    b.set(cx - 1, porchY - 1, d, `${b.main('light')}[hanging=true]`)
    b.set(cx + 1, porchY - 1, d, `${b.main('light')}[hanging=true]`)
  } else {
    b.set(cx - 1, fl(0) + 3, d + 1, `${b.main('light')}[hanging=true]`)
    b.set(cx + 1, fl(0) + 3, d + 1, `${b.main('light')}[hanging=true]`)
  }

  // ---------- Innen: Leiter, Licht ----------
  for (let k = 0; k < storeys - 1; k++)
    for (let y = fl(k) + 1; y <= fl(k + 1); y++) b.set(1, y, 1, 'minecraft:ladder[facing=south]')
  for (let k = 0; k < storeys; k++) b.set(cx, fl(k) + sh - 1, cz, `${b.main('light')}[hanging=true]`)

  // ---------- Schornsteine ----------
  const chimneys: [number, number][] = [[w - 2, d - 2], [1, d - 2]].slice(0, st.chimneys) as [number, number][]
  if (st.chimneys === 1 && r() < 0.35) chimneys.length = 0
  for (const [x, z] of chimneys) {
    let top = R
    for (let y = R; y < R + w + d; y++) if (b.has(x, y, z)) top = y
    for (let y = fl(0) + 1; y <= top + 1; y++) b.role(x, y, z, 'sockel', {}, 0)
    b.set(x, top + 2, z, 'minecraft:campfire[lit=true,signal_fire=false]')
  }

  return b.toBlueprint(`${st.label}es Haus`, source)
}

// ---------- Dächer ----------

function gableRoof(b: Builder, w: number, d: number, R: number, ov: number, st: Style): void {
  const alongZ = d >= w
  const U = alongZ ? w : d, V = alongZ ? d : w
  const put = (u: number, y: number, v: number, role: Role, form: 'stairs' | 'slab' | null, props: Record<string, string>) => {
    const [x, z] = alongZ ? [u, v] : [v, u]
    if (form) b.form(x, y, z, role, form, props)
    else b.role(x, y, z, role, props)
  }
  const up: Facing = alongZ ? 'east' : 'south'
  const down: Facing = alongZ ? 'west' : 'north'
  const ovv = 1
  for (let i = 0; ; i++) {
    const left = -ov + i, right = U - 1 + ov - i
    const y = R - ov + 1 + i
    if (left > right) break
    for (let v = -ovv; v <= V - 1 + ovv; v++) {
      const edge = i === 0 || v === -ovv || v === V - 1 + ovv
      if (left === right) put(left, y, v, 'trim', 'slab', { type: 'bottom' })
      else {
        put(left, y, v, edge ? 'trim' : 'roof', 'stairs', { facing: up, half: 'bottom' })
        put(right, y, v, edge ? 'trim' : 'roof', 'stairs', { facing: down, half: 'bottom' })
      }
    }
    // Giebelwände unter den Dachflächen
    if (y > R) {
      for (let u = Math.max(0, left + 1); u <= Math.min(U - 1, right - 1); u++) {
        for (const v of [0, V - 1]) {
          const center = u === Math.floor((U - 1) / 2)
          const gableWindow = center && y === R + 2 && right - left >= 5
          if (gableWindow) put(u, y, v, 'window', null, {})
          else if (st.frame === 'timber' && (u === 0 || u === U - 1 || center)) put(u, y, v, 'frame', null, { axis: 'y' })
          else put(u, y, v, 'wall', null, {})
        }
      }
    }
  }
}

function hipRoof(b: Builder, w: number, d: number, R: number, ov: number, pagoda: boolean): void {
  for (let i = 0; ; i++) {
    const x0 = -ov + i, x1 = w - 1 + ov - i, z0 = -ov + i, z1 = d - 1 + ov - i
    if (x0 > x1 || z0 > z1) break
    // Pagode: außen zwei flache Stufen (Traufe), danach steil – ergibt den geschwungenen Umriss
    const y = pagoda ? (i < 2 ? R : R + i - 1) : R - ov + 1 + i
    const half = i === 1 ? 'top' : 'bottom'
    const line = x0 === x1 || z0 === z1
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1)
        if (line) {
          b.form(x, y, z, pagoda ? 'trim' : 'roof', 'slab', { type: 'bottom' })
          continue
        }
        if (pagoda && i < 2) {
          if (i === 0 && corner) b.form(x, y, z, 'trim', 'slab', { type: 'top' })
          else b.form(x, y, z, i === 0 ? 'trim' : 'roof', 'slab', { type: half })
          continue
        }
        const facing: Facing = z === z0 ? 'south' : z === z1 ? 'north' : x === x0 ? 'east' : 'west'
        b.form(x, y, z, i === 0 ? 'trim' : 'roof', 'stairs', { facing, half: 'bottom' })
      }
    if (pagoda && i === 0) {
      // aufgebogene Ecken
      for (const [x, z] of [[x0 - 1, z0 - 1], [x1 + 1, z0 - 1], [x0 - 1, z1 + 1], [x1 + 1, z1 + 1]]) b.form(x, y, z, 'trim', 'slab', { type: 'top' })
    }
  }
}

/** Kleines Pultdach-Band zwischen den Stockwerken (Pagoden-Stufe). */
function skirtRoof(b: Builder, w: number, d: number, y: number): void {
  for (const dist of [1, 2]) {
    for (let z = -dist; z <= d - 1 + dist; z++)
      for (let x = -dist; x <= w - 1 + dist; x++) {
        if (x > -dist && x < w - 1 + dist && z > -dist && z < d - 1 + dist) continue
        b.form(x, y, z, dist === 1 ? 'roof' : 'trim', 'slab', { type: dist === 1 ? 'top' : 'bottom' })
      }
  }
}

function flatRoof(b: Builder, w: number, d: number, R: number, ov: number, st: Style): void {
  if (st.roof === 'flat') {
    for (let dist = 1; dist <= ov; dist++)
      for (let z = -dist; z <= d - 1 + dist; z++)
        for (let x = -dist; x <= w - 1 + dist; x++) {
          if (x > -dist && x < w - 1 + dist && z > -dist && z < d - 1 + dist) continue
          b.form(x, R, z, 'trim', 'slab', { type: 'top' })
        }
    for (const [x, z] of perimeter(w, d)) b.form(x, R + 1, z, 'trim', 'slab', { type: 'bottom' })
    return
  }
  // Brüstung mit Zinnen und Balkenköpfen (Wüste)
  for (const [x, z] of perimeter(w, d)) {
    b.role(x, R + 1, z, 'wall')
    if ((x + z) % 2 === 0) b.form(x, R + 2, z, 'trim', 'slab', { type: 'bottom' })
  }
  if (st.vigas) {
    for (let x = 2; x < w - 2; x += 2) {
      b.beam(x, R - 1, -1, 'frame', 'z')
      b.beam(x, R - 1, d, 'frame', 'z')
    }
    for (let z = 2; z < d - 2; z += 2) {
      b.beam(-1, R - 1, z, 'frame', 'x')
      b.beam(w, R - 1, z, 'frame', 'x')
    }
  }
}

// ---------- Hilfen ----------

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function perimeter(w: number, d: number): [number, number][] {
  const out: [number, number][] = []
  for (let x = 0; x < w; x++) out.push([x, 0], [x, d - 1])
  for (let z = 1; z < d - 1; z++) out.push([0, z], [w - 1, z])
  return out
}

/** Abschnitte zwischen Pfosten; ohne Fachwerk künstlich alle "every" Blöcke geteilt. */
function segments(pillars: number[], len: number, every: number): [number, number][] {
  let pts = pillars
  if (every > 0) {
    const s = new Set(pillars)
    for (let i = every; i < len - 2; i += every) s.add(i)
    pts = [...s].sort((a, b) => a - b)
  }
  const out: [number, number][] = []
  for (let i = 0; i < pts.length - 1; i++) if (pts[i + 1] - pts[i] > 1) out.push([pts[i], pts[i + 1]])
  return out
}
