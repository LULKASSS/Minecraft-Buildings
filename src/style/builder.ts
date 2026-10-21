// Baukasten für Generatoren: Blöcke frei im Raum setzen (auch negative Koordinaten),
// Rollen der Palette mischen, Formen aus der Familie holen. Am Ende: Treppenformen wie im Spiel,
// alle Zustände vollständig, und ein Blueprint mit Anker.

import { formatState, isAir, parseState, type BlockState, type Props } from '../blueprint/blockstate'
import { Blueprint, type BlueprintSource, type Vec3 } from '../blueprint/blueprint'
import { complete, exists, fixConnections, fixStairShapes, formOf, type Form } from './blocks'
import { hash3, pick, type Palette, type Role } from './palettes'

/** Kleiner, fester Zufallsgenerator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
export const choose = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]

/** Geländehöhen unter einem Bauwerk, relativ zum Anker (0 = Höhe des Ankerblocks). */
export interface Ground {
  x0: number
  z0: number
  w: number
  d: number
  h: number[]
  /** Spalten (Index wie h), in denen über dem Grund Wasser steht */
  wet?: number[]
  /** Spalten mit Erde/Gras/Moos oben: nur dort lassen sich Blumen und Gras setzen */
  soil?: number[]
}

/** Lässt sich hier eine Pflanze setzen? Ohne Geländedaten: ja. */
export function isSoil(g: Ground | undefined, x: number, z: number): boolean {
  if (!g?.soil) return true
  const i = x - g.x0, k = z - g.z0
  return i >= 0 && k >= 0 && i < g.w && k < g.d && g.soil.includes(k * g.w + i)
}

export function isWet(g: Ground | undefined, x: number, z: number): boolean {
  if (!g?.wet?.length) return false
  const i = x - g.x0, k = z - g.z0
  return i >= 0 && k >= 0 && i < g.w && k < g.d && g.wet.includes(k * g.w + i)
}

export function groundAt(g: Ground | undefined, x: number, z: number): number {
  if (!g) return 0
  const i = x - g.x0, k = z - g.z0
  if (i < 0 || k < 0 || i >= g.w || k >= g.d) return 0
  const v = g.h[k * g.w + i]
  return Number.isFinite(v) ? v : 0
}

const completed = new Map<string, BlockState>()
function done(s: BlockState): BlockState {
  let c = completed.get(s)
  if (!c) completed.set(s, (c = complete(s)))
  return c
}

export class Builder {
  private cells = new Map<string, BlockState>()
  /** Zellen, die das Nachrechnen von Treppenformen und Verbindungen nicht ändern darf (Funktionskern). */
  private locked = new Set<string>()
  anchor: Vec3 = [0, 0, 0]

  constructor(readonly palette: Palette | null, readonly seed: number) {}

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(this.key(x, y, z))
  }

  get(x: number, y: number, z: number): BlockState | undefined {
    return this.cells.get(this.key(x, y, z))
  }

  set(x: number, y: number, z: number, state: BlockState): void {
    if (isAir(state)) this.cells.delete(this.key(x, y, z))
    else this.cells.set(this.key(x, y, z), done(state.includes(':') ? state : `minecraft:${state}`))
  }

  /** Unverändert übernehmen (Vorlagen aus anderen Versionen): ohne Ergänzung und Prüfung. */
  raw(x: number, y: number, z: number, state: BlockState): void {
    this.cells.set(this.key(x, y, z), state)
    this.locked.add(this.key(x, y, z))
  }

  /** Nur setzen, wenn dort noch nichts ist (Laub um Äste, Pflanzen). */
  soft(x: number, y: number, z: number, state: BlockState): void {
    if (!this.has(x, y, z)) this.set(x, y, z, state)
  }

  clear(x: number, y: number, z: number): void {
    this.cells.delete(this.key(x, y, z))
  }

  /** Block einer Rolle (gemischt, unten verwittert). */
  id(role: Role, x: number, y: number, z: number, lowUntil = 2): string {
    if (!this.palette) throw new Error('Keine Palette')
    return pick(this.palette.roles[role], x, y, z, this.seed, lowUntil)
  }

  main(role: Role): string {
    return this.palette!.roles[role][0].id
  }

  role(x: number, y: number, z: number, role: Role, props: Props = {}, lowUntil = 2): void {
    const id = this.id(role, x, y, z, lowUntil)
    this.set(x, y, z, withProps(id, props))
  }

  /** Form (Treppe, Stufe, Zaun …) im Material einer Rolle; fällt auf den Hauptblock der Rolle zurück. */
  form(x: number, y: number, z: number, role: Role, form: Form, props: Props = {}): void {
    // Ausweichen, wenn das Material die Form nicht hat (z. B. glatter Stein ohne Treppe)
    this.set(x, y, z, this.formState(role, form, props, x, y, z))
  }

  /** Zustand einer Form an einer Stelle, ohne ihn zu setzen (für soft). */
  formState(role: Role, form: Form, props: Props, x: number, y: number, z: number): BlockState {
    const id = this.id(role, x, y, z)
    const fallback: Role[] = role === 'trim' ? ['roof', 'sockel'] : role === 'detail' ? ['trim', 'roof'] : ['sockel', 'wall']
    const b = formOf(id, form) ?? formOf(this.main(role), form) ?? fallback.map(r => formOf(this.main(r), form)).find(Boolean)
    if (!b) throw new Error(`${this.main(role)} hat keine Form ${form}`)
    return withProps(b, props)
  }

  beamState(role: Role, axis: 'x' | 'y' | 'z', x: number, y: number, z: number): BlockState {
    return withProps(this.id(role, x, y, z), { axis })
  }

  /** Stamm oder Balken: setzt die Achse, falls der Block eine hat. */
  beam(x: number, y: number, z: number, role: Role, axis: 'x' | 'y' | 'z'): void {
    const id = this.id(role, x, y, z)
    this.set(x, y, z, withProps(id, { axis }))
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: (x: number, y: number, z: number) => void): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) f(x, y, z)
  }

  noise(x: number, y: number, z: number, salt = 0): number {
    return hash3(x, y, z, this.seed * 31 + salt)
  }

  get count(): number {
    return this.cells.size
  }

  toBlueprint(name: string, source: BlueprintSource, kind: 'decorative' | 'functional' = 'decorative'): Blueprint {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    for (const k of this.cells.keys()) {
      const [x, y, z] = k.split(',').map(Number)
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z)
      x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z)
    }
    if (!Number.isFinite(x0)) { x0 = y0 = z0 = x1 = y1 = z1 = 0 }
    const bp = new Blueprint({
      size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1],
      name,
      kind,
      source,
      anchor: [this.anchor[0] - x0, this.anchor[1] - y0, this.anchor[2] - z0],
    })
    for (const [k, s] of this.cells) {
      const [x, y, z] = k.split(',').map(Number)
      bp.set(x - x0, y - y0, z - z0, s)
    }
    const get = (x: number, y: number, z: number) => bp.get(x, y, z)
    const put = (x: number, y: number, z: number, s: BlockState) => {
      if (!this.locked.has(this.key(x + x0, y + y0, z + z0))) bp.set(x, y, z, done(s))
    }
    fixStairShapes(bp.size, get, put)
    fixConnections(bp.size, get, put)
    return bp
  }
}

/** Properties nur setzen, die der Block auch hat. */
export function withProps(id: string, props: Props): BlockState {
  const full = id.includes(':') ? id : `minecraft:${id}`
  if (!exists(full)) throw new Error(`Unbekannter Block: ${id}`)
  const { name } = parseState(full)
  return formatState(name, props)
}

export const FACINGS = ['north', 'east', 'south', 'west'] as const
export type Facing = (typeof FACINGS)[number]
export const OPPOSITE: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' }
