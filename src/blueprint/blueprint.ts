// Das eine Format für alle Bauwerke. Generator, Karte, 3D, Anleitung und Export lesen nur hieraus.

import { AIR, canonical, isAir, type BlockState } from './blockstate'

export type Vec3 = [number, number, number]

export interface BlueprintSource {
  generator: string
  version: number
  seed: number
  params: Record<string, unknown>
}

export interface BlockEntry {
  x: number
  y: number
  z: number
  state: BlockState
}

export class Blueprint {
  readonly size: Vec3
  anchor: Vec3
  readonly palette: BlockState[] = [AIR]
  readonly blocks: Uint16Array
  kind: 'decorative' | 'functional'
  source: BlueprintSource
  name: string
  private lookup = new Map<BlockState, number>([[AIR, 0]])

  constructor(opts: {
    size: Vec3
    name: string
    anchor?: Vec3
    kind?: 'decorative' | 'functional'
    source: BlueprintSource
  }) {
    const [w, h, d] = opts.size
    if (w < 1 || h < 1 || d < 1) throw new Error('Bauwerk braucht mindestens 1×1×1')
    this.size = [w, h, d]
    this.name = opts.name
    this.anchor = opts.anchor ?? [0, 0, 0]
    this.kind = opts.kind ?? 'decorative'
    this.source = opts.source
    this.blocks = new Uint16Array(w * h * d)
  }

  /** Reihenfolge y → z → x, wie Litematica und Sponge-Schematic. */
  index(x: number, y: number, z: number): number {
    const [w, , d] = this.size
    return (y * d + z) * w + x
  }

  inside(x: number, y: number, z: number): boolean {
    const [w, h, d] = this.size
    return x >= 0 && y >= 0 && z >= 0 && x < w && y < h && z < d
  }

  paletteIndex(state: BlockState): number {
    const key = isAir(state) ? AIR : canonical(state)
    let i = this.lookup.get(key)
    if (i === undefined) {
      i = this.palette.length
      if (i > 0xffff) throw new Error('Zu viele verschiedene Blöcke')
      this.palette.push(key)
      this.lookup.set(key, i)
    }
    return i
  }

  set(x: number, y: number, z: number, state: BlockState): void {
    if (!this.inside(x, y, z)) throw new Error(`Block außerhalb des Bauwerks: ${x} ${y} ${z}`)
    this.blocks[this.index(x, y, z)] = this.paletteIndex(state)
  }

  get(x: number, y: number, z: number): BlockState {
    if (!this.inside(x, y, z)) return AIR
    return this.palette[this.blocks[this.index(x, y, z)]]
  }

  fill(from: Vec3, to: Vec3, state: BlockState): void {
    const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])]
    const [y0, y1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])]
    const [z0, z1] = [Math.min(from[2], to[2]), Math.max(from[2], to[2])]
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, state)
  }

  /** Die Blockliste mit relativen Koordinaten, ohne Luft. */
  *each(): Generator<BlockEntry> {
    const [w, h, d] = this.size
    let i = 0
    for (let y = 0; y < h; y++)
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++, i++) {
          const p = this.blocks[i]
          if (p !== 0) yield { x, y, z, state: this.palette[p] }
        }
  }

  list(): BlockEntry[] {
    return [...this.each()]
  }

  count(): number {
    let n = 0
    for (const p of this.blocks) if (p !== 0) n++
    return n
  }

  /** Palette nur mit tatsächlich benutzten Zuständen, Luft bleibt vorn. */
  compact(): { palette: BlockState[]; blocks: Uint16Array } {
    const used = new Map<number, number>([[0, 0]])
    const palette: BlockState[] = [AIR]
    const blocks = new Uint16Array(this.blocks.length)
    for (let i = 0; i < this.blocks.length; i++) {
      const p = this.blocks[i]
      let n = used.get(p)
      if (n === undefined) {
        n = palette.length
        palette.push(this.palette[p])
        used.set(p, n)
      }
      blocks[i] = n
    }
    return { palette, blocks }
  }
}
