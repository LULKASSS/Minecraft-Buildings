// Natur: Bäume je Holzart, Büsche, Felsen, Wiesen und der Natur-Pinsel, der eine Fläche locker bepflanzt.
// Laub ist "persistent", damit es nach dem Nachbauen nicht zerfällt.

import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { Builder, choose, groundAt, isSoil, isWet, randInt, rng, type Ground } from '../style/builder'
import type { Size } from './styles'

export type Species = 'oak' | 'birch' | 'spruce' | 'cherry' | 'dark_oak' | 'acacia'
export const SPECIES: { id: Species; label: string }[] = [
  { id: 'oak', label: 'Eiche' }, { id: 'birch', label: 'Birke' }, { id: 'spruce', label: 'Fichte' },
  { id: 'cherry', label: 'Kirsche' }, { id: 'dark_oak', label: 'Dunkeleiche' }, { id: 'acacia', label: 'Akazie' },
]

export type Mix = 'wald' | 'nadelwald' | 'kirschhain' | 'wiese' | 'savanne' | 'felsen'
export const MIXES: { id: Mix; label: string }[] = [
  { id: 'wald', label: 'Laubwald' }, { id: 'nadelwald', label: 'Nadelwald' }, { id: 'kirschhain', label: 'Kirschhain' },
  { id: 'wiese', label: 'Blumenwiese' }, { id: 'savanne', label: 'Savanne' }, { id: 'felsen', label: 'Felsen' },
]

export interface NatureParams {
  species?: Species
  mix?: Mix
  size: Size
  ground?: Ground
}

type R = () => number
const leaves = (sp: string) => `minecraft:${sp}_leaves[persistent=true]`
const log = (sp: string, axis: 'x' | 'y' | 'z' = 'y') => `minecraft:${sp}_log[axis=${axis}]`

/** Laubklumpen: Ellipsoid mit ausgefranstem Rand. */
function blob(b: Builder, sp: string, cx: number, cy: number, cz: number, rx: number, ry: number, r: R): void {
  const R = Math.ceil(rx), RY = Math.ceil(ry)
  for (let y = -RY; y <= RY; y++)
    for (let z = -R; z <= R; z++)
      for (let x = -R; x <= R; x++) {
        const v = (x * x + z * z) / (rx * rx) + (y * y) / (ry * ry)
        if (v <= 1 - r() * 0.38) b.soft(cx + x, cy + y, cz + z, leaves(sp))
      }
}

function line(b: Builder, sp: string, x0: number, y0: number, z0: number, dx: number, dz: number, len: number, rise: number): [number, number, number] {
  let x = x0, y = y0, z = z0
  for (let i = 1; i <= len; i++) {
    x = x0 + Math.round(dx * i)
    z = z0 + Math.round(dz * i)
    y = y0 + Math.floor(i * rise)
    b.set(x, y, z, log(sp, Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z'))
  }
  return [x, y, z]
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]

/** Baum mit Stammfuß auf (x, y, z). */
export function drawTree(b: Builder, sp: Species, size: Size, x: number, y: number, z: number, r: R): void {
  const s = { S: 0, M: 1, L: 2 }[size]
  if (sp === 'oak') {
    const h = 5 + s * 2 + randInt(r, 0, 1)
    for (let i = 0; i < h; i++) b.set(x, y + i, z, log(sp))
    if (s === 2) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (r() < 0.7) b.set(x + dx, y, z + dz, log(sp, dx ? 'x' : 'z'))
    blob(b, sp, x, y + h, z, 2.2 + s * 0.6, 1.8 + s * 0.3, r)
    const branches = s === 0 ? 1 : randInt(r, 2, 3 + s)
    const used = new Set<number>()
    for (let i = 0; i < branches; i++) {
      let di = Math.floor(r() * DIRS.length)
      while (used.has(di)) di = (di + 1) % DIRS.length
      used.add(di)
      const [dx, dz] = DIRS[di]
      const end = line(b, sp, x, y + Math.floor(h * (0.5 + r() * 0.35)), z, dx, dz, 2 + s, 0.5)
      blob(b, sp, end[0], end[1] + 1, end[2], 1.8 + s * 0.4, 1.4, r)
    }
  } else if (sp === 'birch') {
    const h = 7 + s * 2 + randInt(r, 0, 2)
    for (let i = 0; i < h; i++) b.set(x, y + i, z, log(sp))
    for (let i = Math.floor(h * 0.55); i <= h; i += 2) blob(b, sp, x, y + i, z, 1.6 + s * 0.3 + (i === h ? -0.4 : 0), 1.3, r)
    b.soft(x, y + h + 1, z, leaves(sp))
  } else if (sp === 'spruce') {
    const h = 8 + s * 4 + randInt(r, 0, 2)
    for (let i = 0; i < h; i++) b.set(x, y + i, z, log(sp))
    const bottom = Math.floor(h * 0.25), maxR = 2 + s
    for (let i = bottom; i <= h; i++) {
      const t = (i - bottom) / (h - bottom)
      const rr = Math.max(0.6, maxR * (1 - t) + ((i - bottom) % 2 ? -0.6 : 0.3))
      for (let dz = -Math.ceil(rr); dz <= Math.ceil(rr); dz++)
        for (let dx = -Math.ceil(rr); dx <= Math.ceil(rr); dx++)
          if (dx * dx + dz * dz <= rr * rr + 0.3 && !(dx === 0 && dz === 0 && i < h)) b.soft(x + dx, y + i, z + dz, leaves(sp))
    }
    b.soft(x, y + h, z, leaves(sp))
    b.soft(x, y + h + 1, z, leaves(sp))
  } else if (sp === 'cherry') {
    const h = 3 + s + randInt(r, 0, 1)
    for (let i = 0; i < h; i++) b.set(x, y + i, z, log(sp))
    const arms = 2 + (s > 0 ? 1 : 0)
    const start = Math.floor(r() * 8)
    for (let i = 0; i < arms; i++) {
      const [dx, dz] = DIRS[(start + i * 3) % 8]
      const end = line(b, sp, x, y + h - 1, z, dx, dz, 2 + s, 0.8)
      blob(b, sp, end[0], end[1] + 1, end[2], 2.6 + s * 0.6, 1.4 + s * 0.2, r)
    }
  } else if (sp === 'dark_oak') {
    const h = 5 + s * 2 + randInt(r, 0, 1)
    for (let i = 0; i < h; i++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) b.set(x + dx, y + i, z + dz, log(sp))
    blob(b, sp, x, y + h, z, 3.6 + s * 0.8, 1.6, r)
    blob(b, sp, x + 1, y + h - 2, z + 1, 2.4 + s * 0.6, 1.2, r)
    for (let i = 0; i < 2 + s; i++) {
      const [dx, dz] = DIRS[Math.floor(r() * 8)]
      const end = line(b, sp, x, y + h - 2, z, dx, dz, 2 + s, 0.4)
      blob(b, sp, end[0], end[1] + 1, end[2], 2, 1.2, r)
    }
  } else {
    // Akazie: Stamm knickt ab, flache Schirme
    const h = 3 + s + randInt(r, 0, 1)
    for (let i = 0; i < h; i++) b.set(x, y + i, z, log(sp))
    const [dx, dz] = DIRS[Math.floor(r() * 4)]
    const top = line(b, sp, x, y + h - 1, z, dx, dz, 2 + s, 1)
    disk(b, sp, top[0], top[1] + 1, top[2], 2.6 + s * 0.6)
    disk(b, sp, top[0], top[1] + 2, top[2], 1.6 + s * 0.4)
    if (s > 0) {
      const side = line(b, sp, x, y + h - 2, z, -dx, -dz, 2, 1)
      disk(b, sp, side[0], side[1] + 1, side[2], 2)
    }
  }
}

function disk(b: Builder, sp: string, cx: number, y: number, cz: number, rr: number): void {
  for (let z = -Math.ceil(rr); z <= Math.ceil(rr); z++)
    for (let x = -Math.ceil(rr); x <= Math.ceil(rr); x++) if (x * x + z * z <= rr * rr + 0.4) b.soft(cx + x, y, cz + z, leaves(sp))
}

function drawBush(b: Builder, size: Size, x: number, y: number, z: number, r: R, sp = 'oak'): void {
  const rr = { S: 1.1, M: 1.6, L: 2.2 }[size]
  b.set(x, y, z, log(sp))
  const kinds = sp === 'oak' ? ['oak', 'azalea', 'flowering_azalea'] : [sp, sp, 'azalea']
  const R = Math.ceil(rr)
  for (let dy = 0; dy <= R; dy++)
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const v = (dx * dx + dz * dz) / (rr * rr) + (dy * dy) / ((rr * 0.8) * (rr * 0.8))
        if (v <= 1 - r() * 0.3) b.soft(x + dx, y + dy, z + dz, leaves(choose(r, kinds)))
      }
}

const STONES = ['stone', 'andesite', 'cobblestone', 'tuff']

function drawRock(b: Builder, size: Size, x: number, y: number, z: number, r: R): void {
  const rr = { S: 1.3, M: 2.1, L: 3.1 }[size]
  const R = Math.ceil(rr)
  const sx = 1 + r() * 0.4, sz = 1 + r() * 0.4
  for (let dy = 0; dy <= R; dy++)
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const v = (dx * dx) / (rr * rr * sx) + (dz * dz) / (rr * rr * sz) + (dy * dy) / (rr * rr * 0.55)
        if (v > 1 - r() * 0.25) continue
        const mossy = dy === 0 || (dy === R - 1 && r() < 0.4)
        b.set(x + dx, y + dy, z + dz, `minecraft:${mossy && r() < 0.6 ? 'mossy_cobblestone' : choose(r, STONES)}`)
      }
}

const FLOWERS = ['poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'allium', 'red_tulip', 'white_tulip']
const TALL = ['tall_grass', 'large_fern', 'rose_bush', 'lilac', 'peony']

function plant(b: Builder, x: number, y: number, z: number, r: R, mix: Mix): void {
  const v = r()
  if (mix === 'kirschhain' && v < 0.45) {
    b.soft(x, y, z, `minecraft:pink_petals[facing=${choose(r, ['north', 'east', 'south', 'west'])},flower_amount=${randInt(r, 1, 4)}]`)
    return
  }
  if (mix === 'nadelwald') {
    if (v < 0.3) b.soft(x, y, z, 'minecraft:fern')
    else if (v < 0.36 && !b.has(x, y + 1, z)) tall(b, x, y, z, 'large_fern')
    else if (v < 0.5) b.soft(x, y, z, 'minecraft:short_grass')
    return
  }
  const flowerShare = mix === 'wiese' ? 0.35 : mix === 'savanne' ? 0.02 : 0.12
  if (v < flowerShare) b.soft(x, y, z, `minecraft:${choose(r, FLOWERS)}`)
  else if (v < flowerShare + 0.06 && !b.has(x, y + 1, z)) tall(b, x, y, z, mix === 'savanne' ? 'tall_grass' : choose(r, TALL))
  else if (v < flowerShare + (mix === 'savanne' ? 0.5 : 0.4)) b.soft(x, y, z, 'minecraft:short_grass')
}

function tall(b: Builder, x: number, y: number, z: number, id: string): void {
  if (b.has(x, y, z) || b.has(x, y + 1, z)) return
  b.set(x, y, z, `minecraft:${id}[half=lower]`)
  b.set(x, y + 1, z, `minecraft:${id}[half=upper]`)
}

// ---------- Generatoren ----------

export function buildTree(source: BlueprintSource): Blueprint {
  const p = source.params as unknown as NatureParams
  const b = new Builder(null, source.seed)
  b.anchor = [0, -1, 0] // Stammfuß steht auf dem anvisierten Block
  drawTree(b, p.species ?? 'oak', p.size, 0, 0, 0, rng(source.seed * 31 + 1))
  return b.toBlueprint(`${SPECIES.find(s => s.id === p.species)?.label ?? 'Baum'}`, source)
}

export function buildBush(source: BlueprintSource): Blueprint {
  const p = source.params as unknown as NatureParams
  const b = new Builder(null, source.seed)
  b.anchor = [0, -1, 0]
  drawBush(b, p.size, 0, 0, 0, rng(source.seed * 31 + 2))
  return b.toBlueprint('Busch', source)
}

export function buildRock(source: BlueprintSource): Blueprint {
  const p = source.params as unknown as NatureParams
  const b = new Builder(null, source.seed)
  b.anchor = [0, 0, 0] // halb eingesunken
  drawRock(b, p.size, 0, 0, 0, rng(source.seed * 31 + 3))
  return b.toBlueprint('Fels', source)
}

const RADIUS: Record<Size, number> = { S: 6, M: 10, L: 14 }

export function scatterExtent(source: BlueprintSource) {
  const r = RADIUS[(source.params as unknown as NatureParams).size]
  return { x0: -r, z0: -r, x1: r, z1: r }
}

interface MixRule {
  trees: [Species, number][]
  treeDist: number
  bushes: number
  rocks: number
  bushSp?: string
}

const RULES: Record<Mix, MixRule> = {
  wald: { trees: [['oak', 3], ['birch', 2]], treeDist: 6, bushes: 0.6, rocks: 0.1 },
  nadelwald: { trees: [['spruce', 1]], treeDist: 5, bushes: 0.2, rocks: 0.5, bushSp: 'spruce' },
  kirschhain: { trees: [['cherry', 1]], treeDist: 7, bushes: 0.4, rocks: 0.1 },
  wiese: { trees: [['oak', 1]], treeDist: 14, bushes: 0.5, rocks: 0.15 },
  savanne: { trees: [['acacia', 1]], treeDist: 10, bushes: 0.15, rocks: 0.2, bushSp: 'acacia' },
  felsen: { trees: [], treeDist: 99, bushes: 0.2, rocks: 1.6 },
}

/** Natur-Pinsel: eine runde Fläche locker bepflanzen, dem Gelände folgend. */
export function buildScatter(source: BlueprintSource): Blueprint {
  const p = source.params as unknown as NatureParams
  const mix = p.mix ?? 'wald'
  const rule = RULES[mix]
  const rad = RADIUS[p.size]
  const g = p.ground
  const r = rng(source.seed * 31 + 4)
  const b = new Builder(null, source.seed)
  b.anchor = [0, 0, 0]
  const inside = (x: number, z: number, margin = 0) => x * x + z * z <= (rad - margin) * (rad - margin)
  const gy = (x: number, z: number) => groundAt(g, x, z)
  const taken: [number, number, number][] = []
  const dry = (x: number, z: number) => !isWet(g, x, z)
  const free = (x: number, z: number, dist: number) => dry(x, z) && taken.every(([tx, tz, td]) => (tx - x) ** 2 + (tz - z) ** 2 >= Math.max(td, dist) ** 2)
  const area = Math.PI * rad * rad

  // Bäume zuerst (Abstand), dann Felsen, Büsche, zuletzt Bodenbewuchs
  const treeCount = rule.trees.length ? Math.round(area / (rule.treeDist * rule.treeDist * 1.1)) : 0
  const total = rule.trees.reduce((n, t) => n + t[1], 0)
  for (let tries = 0, placed = 0; placed < treeCount && tries < 200; tries++) {
    const x = randInt(r, -rad, rad), z = randInt(r, -rad, rad)
    if (!inside(x, z, 2) || !free(x, z, rule.treeDist)) continue
    let v = r() * total, sp: Species = rule.trees[0][0]
    for (const [s, w] of rule.trees) if ((v -= w) < 0) { sp = s; break }
    drawTree(b, sp, r() < 0.35 ? 'L' : 'M', x, gy(x, z) + 1, z, r)
    taken.push([x, z, rule.treeDist])
    placed++
  }
  const rocks = Math.round((area / 60) * rule.rocks)
  for (let tries = 0, placed = 0; placed < rocks && tries < 100; tries++) {
    const x = randInt(r, -rad, rad), z = randInt(r, -rad, rad)
    if (!inside(x, z, 2) || !free(x, z, 4)) continue
    drawRock(b, choose(r, ['S', 'S', 'M', mix === 'felsen' ? 'L' : 'S'] as Size[]), x, gy(x, z), z, r)
    taken.push([x, z, 4])
    placed++
  }
  const bushes = Math.round((area / 40) * rule.bushes)
  for (let tries = 0, placed = 0; placed < bushes && tries < 100; tries++) {
    const x = randInt(r, -rad, rad), z = randInt(r, -rad, rad)
    if (!inside(x, z, 1) || !free(x, z, 3)) continue
    drawBush(b, r() < 0.5 ? 'S' : 'M', x, gy(x, z) + 1, z, r, rule.bushSp)
    taken.push([x, z, 2])
    placed++
  }
  for (let z = -rad; z <= rad; z++)
    for (let x = -rad; x <= rad; x++) {
      if (!inside(x, z)) continue
      const edge = Math.sqrt(x * x + z * z) / rad
      if (r() < edge * 0.6) continue // zum Rand hin lichter
      const y = gy(x, z) + 1
      if (dry(x, z) && isSoil(g, x, z) && !b.has(x, y, z)) plant(b, x, y, z, r, mix)
    }
  return b.toBlueprint(MIXES.find(m => m.id === mix)?.label ?? 'Natur', source)
}
