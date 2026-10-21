// Eine geöffnete Welt: Quelle, level.dat-Daten, Worker für Kacheln und Gelände, Kachel-Zwischenspeicher.
// Kacheln werden nach Nähe zur Kartenmitte geladen, danach füllt sich der Rest im Hintergrund
// (für die Spuren). Stürzt ein Worker ab oder hängt er, wird er ersetzt statt die Karte stehen zu lassen.

import type { RGB } from '../render/block-colors'
import type { AreaResult, Box3 } from '../world/area'
import { NO_SURFACE } from '../world/chunk'
import { openWorld, type RegionRef, type WorldInfo } from '../world/level'
import type { WorldSource } from '../world/source'
import { TILE } from '../world/tile'
import { findHotspots, type Hotspot } from '../world/traces'
import type { WorkerRequest } from '../world/world.worker'
import * as store from './store'

export interface Tile {
  rx: number
  rz: number
  bitmap: ImageBitmap | null
  /** Bild als PNG, um ausgelagerte Bitmaps wiederherzustellen */
  png: Blob | null
  trace: ImageBitmap | null
  heights: Int16Array | null
  inhabited: Float32Array | null
  built: Uint16Array | null
  lodH: Int16Array | null
  lodC: Uint8Array | null
  state: 'idle' | 'loading' | 'ready' | 'error'
  /** Farben haben sich geändert: altes Bild bleibt stehen, bis das neue da ist */
  stale: boolean
  restoring?: boolean
  tries: number
  error?: string
}

interface TileReply {
  bitmap: ImageBitmap; png: Blob; trace: ImageBitmap; tracePng: Blob
  heights: Int16Array; inhabited: Float32Array; built: Uint16Array; lodH: Int16Array; lodC: Uint8Array
  chunks: number; skipped: { legacy: number; incomplete: number; errors: string[] }
}

interface CachedTile {
  modified: number; png: Blob; tracePng: Blob; heights: ArrayBuffer; inhabited: ArrayBuffer; built: ArrayBuffer; lodH: ArrayBuffer; lodC: ArrayBuffer; legacy: number
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
type Req = DistributiveOmit<WorkerRequest, 'id'>
interface Job { id: number; req: Req; prio: number; resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }
interface Slot { w: Worker; job: Job | null }

const JOB_TIMEOUT = 120_000
const MAX_BITMAPS = 48 // je 1 MB; weiter entfernte Kacheln werden aus dem PNG neu erzeugt
// 4: Höhen gegengeprüft (Fassung 8) – ältere Kacheln im Speicher hatten falsche Höhen
// 5: Palette ab 26.3 – vorher war in 26.3-Welten jeder Block „undefined“ (alles bebaut, Oberkante Y 320)
const CACHE_VERSION = 5

class Pool {
  private slots: Slot[] = []
  private queue: Job[] = []
  private seq = 0

  constructor(readonly size: number) {
    for (let i = 0; i < size; i++) this.slots.push(this.spawn())
  }

  private spawn(): Slot {
    const w = new Worker(new URL('../world/world.worker.ts', import.meta.url), { type: 'module' })
    const slot: Slot = { w, job: null }
    w.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const j = slot.job
      if (!j || j.id !== ev.data.id) return
      clearTimeout(j.timer)
      slot.job = null
      if (ev.data.ok) j.resolve(ev.data.result)
      else j.reject(new Error(ev.data.error))
      this.pump()
    }
    w.onerror = ev => {
      ev.preventDefault()
      this.replace(slot, `Worker abgestürzt${ev.message ? `: ${ev.message}` : ''}`)
    }
    w.onmessageerror = () => this.replace(slot, 'Antwort des Workers nicht lesbar')
    return slot
  }

  private replace(slot: Slot, why: string): void {
    const j = slot.job
    slot.w.terminate()
    const i = this.slots.indexOf(slot)
    if (i >= 0) this.slots[i] = this.spawn()
    if (j) {
      clearTimeout(j.timer)
      j.reject(new Error(why))
    }
    this.pump()
  }

  /** Kleinere prio = früher. */
  run<T>(req: Req, prio = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id: ++this.seq, req, prio, resolve: resolve as (v: unknown) => void, reject })
      this.pump()
    })
  }

  get busy(): number {
    return this.slots.filter(s => s.job).length + this.queue.length
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue
      let best = 0
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].prio < this.queue[best].prio) best = i
      const job = this.queue.splice(best, 1)[0]
      slot.job = job
      job.timer = setTimeout(() => this.replace(slot, 'Worker hat nicht geantwortet (Zeitüberschreitung)'), JOB_TIMEOUT)
      slot.w.postMessage({ ...job.req, id: job.id })
    }
  }

  dispose(): void {
    for (const s of this.slots) {
      clearTimeout(s.job?.timer)
      s.w.terminate()
    }
    this.queue = []
  }
}

export class WorldSession {
  readonly tiles = new Map<string, Tile>()
  private pool: Pool
  private regionIndex: Map<string, RegionRef>
  private mccFiles: string[] = []
  private view = { x: 0, z: 0, rx0: 0, rz0: 0, rx1: -1, rz1: -1 }
  private active = 0
  private areaJobs = 0
  private disposed = false
  private hotspotCache: Hotspot[] | null = null
  onTile: (t: Tile) => void = () => {}
  onProgress: () => void = () => {}
  colors: Record<string, RGB> | undefined
  private colorsId = 'flat'

  private constructor(readonly src: WorldSource, readonly info: WorldInfo, readonly demo: boolean) {
    this.pool = new Pool(Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)))
    this.regionIndex = new Map(info.regions.map(r => [`${r.rx},${r.rz}`, r]))
    for (const r of info.regions) this.tiles.set(`${r.rx},${r.rz}`, blank(r.rx, r.rz))
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

  /** Die Karte meldet, was sie gerade zeigt; danach richtet sich die Reihenfolge. */
  setView(x: number, z: number, rx0: number, rz0: number, rx1: number, rz1: number): void {
    const v = this.view
    if (v.x === x && v.z === z && v.rx0 === rx0 && v.rz0 === rz0 && v.rx1 === rx1 && v.rz1 === rz1) return
    this.view = { x, z, rx0, rz0, rx1, rz1 }
    this.evict()
    this.pump()
  }

  private visible(t: { rx: number; rz: number }): boolean {
    const v = this.view
    return t.rx >= v.rx0 && t.rx <= v.rx1 && t.rz >= v.rz0 && t.rz <= v.rz1
  }

  private distance(t: { rx: number; rz: number }): number {
    const dx = (t.rx + 0.5) * TILE - this.view.x, dz = (t.rz + 0.5) * TILE - this.view.z
    return Math.hypot(dx, dz) + (this.visible(t) ? 0 : 1e7)
  }

  /** Kachel für die Karte. Ausgelagerte Bilder kommen aus dem PNG zurück. */
  tile(rx: number, rz: number): Tile | null {
    const t = this.tiles.get(`${rx},${rz}`)
    if (!t) return null
    if (t.state === 'ready' && !t.bitmap && t.png && !t.restoring) {
      t.restoring = true
      void createImageBitmap(t.png).then(b => {
        t.restoring = false
        if (this.disposed) return b.close()
        t.bitmap = b
        this.onTile(t)
      })
    }
    if (t.state === 'idle') this.pump()
    return t
  }

  progress(): { done: number; total: number } {
    let done = 0
    for (const t of this.tiles.values()) if (t.state === 'ready' || t.state === 'error') done++
    return { done, total: this.tiles.size }
  }

  /** Orte mit der meisten Zeit und den meisten gebauten Blöcken, aus allen geladenen Kacheln. */
  hotspots(): Hotspot[] {
    if (!this.hotspotCache) {
      const stats = [...this.tiles.values()].flatMap(t => (t.inhabited && t.built ? [{ rx: t.rx, rz: t.rz, inhabited: t.inhabited, built: t.built }] : []))
      this.hotspotCache = findHotspots(stats)
    }
    return this.hotspotCache
  }

  private pump(): void {
    if (this.disposed) return
    // Gelände für die 3D-Ansicht geht vor: solange es lädt, keine neuen Kacheln anfangen
    const slots = this.areaJobs ? 0 : this.pool.size + 1
    while (this.active < slots) {
      let best: Tile | null = null, bestD = Infinity
      for (const t of this.tiles.values()) {
        if (t.state === 'loading' || t.state === 'error') continue
        if (t.state === 'ready' && !t.stale) continue
        // veraltete Bilder außerhalb der Sicht nicht neu malen: die Spuren-Daten sind ja da
        if (t.stale && !this.visible(t)) continue
        const d = this.distance(t)
        if (d < bestD) {
          best = t
          bestD = d
        }
      }
      if (!best) return
      this.active++
      void this.loadTile(best).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async loadTile(t: Tile): Promise<void> {
    const ref = this.regionIndex.get(`${t.rx},${t.rz}`)!
    const wasStale = t.stale
    t.state = 'loading'
    try {
      const file = await this.src.read(ref.file)
      if (!file) throw new Error('Region-Datei nicht lesbar')
      const cacheKey = `v${CACHE_VERSION}|${this.key}|${t.rx},${t.rz}|${this.colorsId}`
      const colorsId = this.colorsId
      const cached = this.demo ? undefined : await store.get<CachedTile>('tiles', cacheKey).catch(() => undefined)
      let bitmap: ImageBitmap, png: Blob, trace: ImageBitmap, legacy: number
      if (cached && cached.modified === file.modified && cached.tracePng) {
        bitmap = await createImageBitmap(cached.png)
        trace = await createImageBitmap(cached.tracePng)
        png = cached.png
        t.heights = new Int16Array(cached.heights)
        t.inhabited = new Float32Array(cached.inhabited)
        t.built = new Uint16Array(cached.built)
        t.lodH = new Int16Array(cached.lodH)
        t.lodC = new Uint8Array(cached.lodC)
        legacy = cached.legacy
      } else {
        const r = await this.pool.run<TileReply>(
          { type: 'tile', blob: file.blob, rx: t.rx, rz: t.rz, colors: this.colors, mcc: await this.mccFor(t.rx, t.rz) },
          this.distance(t),
        )
        ;({ bitmap, png, trace } = r)
        t.heights = r.heights
        t.inhabited = r.inhabited
        t.built = r.built
        t.lodH = r.lodH
        t.lodC = r.lodC
        legacy = r.skipped.legacy
        if (!this.demo)
          void store.put('tiles', cacheKey, {
            modified: file.modified, png: r.png, tracePng: r.tracePng, legacy,
            heights: r.heights.slice().buffer, inhabited: r.inhabited.slice().buffer, built: r.built.slice().buffer,
            lodH: r.lodH.slice().buffer, lodC: r.lodC.slice().buffer,
          } satisfies CachedTile).catch(() => {})
      }
      if (this.disposed) {
        bitmap.close()
        trace.close()
        return
      }
      t.bitmap?.close()
      t.trace?.close()
      t.bitmap = bitmap
      t.trace = trace
      t.png = png
      t.state = 'ready'
      // Farben während des Ladens gewechselt? Dann gleich noch einmal
      t.stale = colorsId !== this.colorsId
      t.error = legacy ? `${legacy} Chunks im alten Format (vor 1.18) nicht gelesen` : undefined
      this.hotspotCache = null
    } catch (e) {
      t.tries++
      // ein Absturz kann an zu vielen parallelen Regionen liegen: einmal neu versuchen
      if (t.tries < 2) t.state = t.bitmap ? 'ready' : 'idle'
      else t.state = t.bitmap ? 'ready' : 'error'
      t.stale = wasStale && t.tries < 2
      t.error = String((e as Error).message ?? e)
    }
    this.evict()
    this.onTile(t)
    this.onProgress()
  }

  /** Bitmaps weit weg von der Sicht freigeben; das PNG bleibt. */
  private evict(): void {
    const withBitmap = [...this.tiles.values()].filter(t => t.bitmap && t.png && !this.visible(t))
    let count = [...this.tiles.values()].filter(t => t.bitmap).length
    if (count <= MAX_BITMAPS) return
    withBitmap.sort((a, b) => this.distance(b) - this.distance(a))
    for (const t of withBitmap) {
      if (count <= MAX_BITMAPS) break
      t.bitmap!.close()
      t.bitmap = null
      count--
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

  /** Y des obersten Blocks, falls die Kachel schon da ist. */
  surfaceAt(x: number, z: number): number | null {
    const t = this.tiles.get(`${Math.floor(x / TILE)},${Math.floor(z / TILE)}`)
    if (!t?.heights) return null
    const lx = ((x % TILE) + TILE) % TILE, lz = ((z % TILE) + TILE) % TILE
    const h = t.heights[lx + lz * TILE]
    return h === NO_SURFACE ? null : h
  }

  /** Spalten-Wert für die Anzeige unter der Maus: Zeit und gebaut im Chunk. */
  chunkAt(x: number, z: number): { secs: number; built: number } | null {
    const t = this.tiles.get(`${Math.floor(x / TILE)},${Math.floor(z / TILE)}`)
    if (!t?.inhabited || !t.built) return null
    const i = (((x >> 4) % 32) + 32) % 32 + ((((z >> 4) % 32) + 32) % 32) * 32
    return { secs: t.inhabited[i], built: t.built[i] }
  }

  async surfaceAtAsync(x: number, z: number): Promise<number | null> {
    const t = this.tile(Math.floor(x / TILE), Math.floor(z / TILE))
    if (!t) return null
    while (!t.heights && t.state !== 'error') await new Promise(r => setTimeout(r, 50))
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
    this.areaJobs++
    try {
      return await this.pool.run<AreaResult>({ type: 'area', regions, box }, -1)
    } finally {
      this.areaJobs--
      this.pump()
    }
  }

  /** Neue Kartenfarben (aus der .jar). Die alten Bilder bleiben, bis die neuen fertig sind. */
  setColors(colors: Record<string, RGB>, id = 'tex'): void {
    this.colors = colors
    this.colorsId = id
    for (const t of this.tiles.values()) {
      if (t.state === 'ready') t.stale = true
      if (t.state === 'error') {
        t.state = 'idle'
        t.tries = 0
      }
    }
    this.pump()
    this.onProgress()
  }

  dispose(): void {
    this.disposed = true
    this.pool.dispose()
    for (const t of this.tiles.values()) {
      t.bitmap?.close()
      t.trace?.close()
    }
  }
}

function blank(rx: number, rz: number): Tile {
  return { rx, rz, bitmap: null, png: null, trace: null, heights: null, inhabited: null, built: null, lodH: null, lodC: null, state: 'idle', stale: false, tries: 0 }
}
