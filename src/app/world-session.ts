// Eine geöffnete Welt: Quelle, level.dat-Daten, Worker für Kacheln und Gelände, Kachel-Zwischenspeicher.

import type { RGB } from '../render/block-colors'
import type { AreaResult, Box3 } from '../world/area'
import { NO_SURFACE } from '../world/chunk'
import { openWorld, type RegionRef, type WorldInfo } from '../world/level'
import type { WorldSource } from '../world/source'
import { TILE } from '../world/tile'
import type { WorkerRequest } from '../world/world.worker'
import * as store from './store'

export interface Tile {
  rx: number
  rz: number
  bitmap: ImageBitmap | null
  heights: Int16Array | null
  state: 'loading' | 'ready' | 'error'
  error?: string
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

class Pool {
  private workers: Worker[] = []
  private next = 0
  private seq = 0
  private pending = new Map<number, Pending>()

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../world/world.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const p = this.pending.get(ev.data.id)
        if (!p) return
        this.pending.delete(ev.data.id)
        if (ev.data.ok) p.resolve(ev.data.result)
        else p.reject(new Error(ev.data.error))
      }
      this.workers.push(w)
    }
  }

  run<T>(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<T> {
    const id = ++this.seq
    const w = this.workers[this.next++ % this.workers.length]
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      w.postMessage({ ...req, id })
    })
  }

  dispose(): void {
    for (const w of this.workers) w.terminate()
  }
}

export class WorldSession {
  readonly tiles = new Map<string, Tile>()
  private pool: Pool
  private regionIndex: Map<string, RegionRef>
  private mccFiles: string[] = []
  onTile: (t: Tile) => void = () => {}
  colors: Record<string, RGB> | undefined

  private constructor(readonly src: WorldSource, readonly info: WorldInfo, readonly demo: boolean) {
    this.pool = new Pool(Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)))
    this.regionIndex = new Map(info.regions.map(r => [`${r.rx},${r.rz}`, r]))
  }

  static async open(src: WorldSource, demo = false): Promise<WorldSession> {
    const info = await openWorld(src)
    const s = new WorldSession(src, info, demo)
    s.mccFiles = (await src.list(info.regionDir)).filter(f => f.endsWith('.mcc'))
    return s
  }

  get key(): string {
    return this.demo ? 'demo' : `${this.src.name}|${this.info.name}`
  }

  hasRegion(rx: number, rz: number): boolean {
    return this.regionIndex.has(`${rx},${rz}`)
  }

  regionBounds(): { x0: number; z0: number; x1: number; z1: number } {
    const rs = this.info.regions
    return {
      x0: Math.min(...rs.map(r => r.rx)) * TILE, z0: Math.min(...rs.map(r => r.rz)) * TILE,
      x1: (Math.max(...rs.map(r => r.rx)) + 1) * TILE, z1: (Math.max(...rs.map(r => r.rz)) + 1) * TILE,
    }
  }

  private async mccFor(rx: number, rz: number): Promise<Record<string, Blob> | undefined> {
    const mine = this.mccFiles.filter(f => {
      const m = /^c\.(-?\d+)\.(-?\d+)\.mcc$/.exec(f)
      return m && Number(m[1]) >> 5 === rx && Number(m[2]) >> 5 === rz
    })
    if (!mine.length) return undefined
    const out: Record<string, Blob> = {}
    for (const f of mine) {
      const file = await this.src.read(`${this.info.regionDir}/${f}`)
      if (file) out[f] = file.blob
    }
    return out
  }

  /** Kachel holen: aus dem Speicher, wenn die Region-Datei sich nicht geändert hat, sonst im Worker rendern. */
  tile(rx: number, rz: number): Tile | null {
    const key = `${rx},${rz}`
    const ref = this.regionIndex.get(key)
    if (!ref) return null
    let t = this.tiles.get(key)
    if (t) return t
    t = { rx, rz, bitmap: null, heights: null, state: 'loading' }
    this.tiles.set(key, t)
    void this.loadTile(t, ref)
    return t
  }

  private async loadTile(t: Tile, ref: RegionRef): Promise<void> {
    try {
      const file = await this.src.read(ref.file)
      if (!file) throw new Error('Region-Datei nicht lesbar')
      const cacheKey = `${this.key}|${t.rx},${t.rz}|${this.colors ? 'tex' : 'flat'}`
      const cached = this.demo ? undefined : await store.get<{ modified: number; png: Blob; heights: ArrayBuffer }>('tiles', cacheKey)
      if (cached && cached.modified === file.modified) {
        t.bitmap = await createImageBitmap(cached.png)
        t.heights = new Int16Array(cached.heights)
      } else {
        const r = await this.pool.run<{ bitmap: ImageBitmap; png: Blob; heights: Int16Array; chunks: number; skipped: { legacy: number; errors: string[] } }>({
          type: 'tile', blob: file.blob, rx: t.rx, rz: t.rz, colors: this.colors, mcc: await this.mccFor(t.rx, t.rz),
        })
        t.bitmap = r.bitmap
        t.heights = r.heights
        if (r.skipped.legacy) t.error = `${r.skipped.legacy} Chunks im alten Format (vor 1.18) nicht gelesen`
        if (!this.demo) void store.put('tiles', cacheKey, { modified: file.modified, png: r.png, heights: r.heights.buffer.slice(0) })
      }
      t.state = 'ready'
    } catch (e) {
      t.state = 'error'
      t.error = String((e as Error).message ?? e)
    }
    this.onTile(t)
  }

  /** Y des obersten Blocks, falls die Kachel schon da ist. */
  surfaceAt(x: number, z: number): number | null {
    const t = this.tiles.get(`${Math.floor(x / TILE)},${Math.floor(z / TILE)}`)
    if (!t?.heights) return null
    const lx = ((x % TILE) + TILE) % TILE, lz = ((z % TILE) + TILE) % TILE
    const h = t.heights[lx + lz * TILE]
    return h === NO_SURFACE ? null : h
  }

  async surfaceAtAsync(x: number, z: number): Promise<number | null> {
    const t = this.tile(Math.floor(x / TILE), Math.floor(z / TILE))
    if (!t) return null
    while (t.state === 'loading') await new Promise(r => setTimeout(r, 50))
    return this.surfaceAt(x, z)
  }

  async area(box: Box3): Promise<AreaResult> {
    const regions: { rx: number; rz: number; blob: Blob; mcc?: Record<string, Blob> }[] = []
    for (let rz = box.z0 >> 9; rz <= box.z1 >> 9; rz++)
      for (let rx = box.x0 >> 9; rx <= box.x1 >> 9; rx++) {
        const ref = this.regionIndex.get(`${rx},${rz}`)
        if (!ref) continue
        const f = await this.src.read(ref.file)
        if (f) regions.push({ rx, rz, blob: f.blob, mcc: await this.mccFor(rx, rz) })
      }
    return this.pool.run<AreaResult>({ type: 'area', regions, box })
  }

  setColors(colors: Record<string, RGB>): void {
    this.colors = colors
    this.tiles.clear()
  }

  dispose(): void {
    this.pool.dispose()
  }
}
