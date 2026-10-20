// Kartenkachel = eine Region (512 × 512 Blöcke). Farbe des obersten Blocks, Höhen leicht schattiert.
// Läuft im Worker, ist aber reine Rechnung und damit testbar.

import { parseState } from '../blueprint/blockstate'
import { fallbackColor, isWaterLike, type RGB } from '../render/block-colors'
import { isNatural } from '../style/blocks'
import { blockAt, decodeChunk, NO_SURFACE, type ChunkData } from './chunk'
import { chunkFrom, loadRegion, type ExternalChunk } from './region'

export const TILE = 512
/** Spuren-Ebene in grober Auflösung: 1 Pixel = 4 × 4 Blöcke, spart Speicher bei vielen Regionen */
export const TRACE = 128

export interface TileResult {
  rgba: Uint8ClampedArray
  /** Spuren-Ebene (TRACE × TRACE): gebaute Blöcke und Aufenthalt, halbdurchsichtig */
  trace: Uint8ClampedArray
  heights: Int16Array // Y des obersten Blocks je Spalte (x + z*512), NO_SURFACE = kein Chunk
  /** je Chunk (lx + lz*32): Sekunden, die Spieler dort waren */
  inhabited: Float32Array
  /** je Chunk: Spalten, deren oberster Block gebaut ist (nicht natürlich) */
  built: Uint16Array
  /** Ferne in 3D: höchster Block je 4 × 4 Spalten (TRACE × TRACE), NO_SURFACE = leer */
  lodH: Int16Array
  /** Farbe dieses höchsten Blocks (RGB) */
  lodC: Uint8Array
  chunks: number
  skipped: { legacy: number; incomplete: number; errors: string[] }
}

export type ColorFn = (name: string) => RGB

export async function renderTile(blob: Blob, rx: number, rz: number, color: ColorFn = fallbackColor, external?: ExternalChunk): Promise<TileResult> {
  const region = await loadRegion(blob)
  const heights = new Int16Array(TILE * TILE).fill(NO_SURFACE)
  const base = new Uint8ClampedArray(TILE * TILE * 3)
  const water = new Uint8Array(TILE * TILE) // Wassertiefe, 0 = kein Wasser
  const builtMask = new Uint8Array(TILE * TILE)
  const res: TileResult = {
    rgba: new Uint8ClampedArray(TILE * TILE * 4), trace: new Uint8ClampedArray(TRACE * TRACE * 4), heights,
    inhabited: new Float32Array(1024), built: new Uint16Array(1024),
    lodH: new Int16Array(TRACE * TRACE).fill(NO_SURFACE), lodC: new Uint8Array(TRACE * TRACE * 3), chunks: 0, skipped: { legacy: 0, incomplete: 0, errors: [] },
  }

  for (let lz = 0; lz < 32; lz++)
    for (let lx = 0; lx < 32; lx++) {
      const cx = rx * 32 + lx, cz = rz * 32 + lz
      let chunk: ChunkData
      try {
        const bytes = await chunkFrom(region, cx, cz, external)
        if (!bytes) continue
        const r = decodeChunk(bytes)
        if (!r.ok) {
          res.skipped[r.reason]++
          continue
        }
        chunk = r.chunk
      } catch (e) {
        if (res.skipped.errors.length < 5) res.skipped.errors.push(String((e as Error).message ?? e))
        continue
      }
      res.chunks++
      res.inhabited[lx + lz * 32] = chunk.inhabited
      res.built[lx + lz * 32] = paintChunk(chunk, lx * 16, lz * 16, heights, base, water, builtMask, color)
    }

  // Schattierung: höher als der nördliche Nachbar = heller, tiefer = dunkler (wie die Karte im Spiel).
  for (let z = 0; z < TILE; z++)
    for (let x = 0; x < TILE; x++) {
      const i = x + z * TILE
      const h = heights[i]
      if (h === NO_SURFACE) continue
      let f = 1
      if (water[i]) {
        f = 1 - Math.min(water[i], 12) * 0.035
      } else {
        const hn = z > 0 ? heights[i - TILE] : NO_SURFACE
        const hw = x > 0 ? heights[i - 1] : NO_SURFACE
        const dn = hn === NO_SURFACE ? 0 : h - hn
        const dw = hw === NO_SURFACE ? 0 : h - hw
        f = 1 + Math.max(-4, Math.min(4, dn)) * 0.045 + Math.max(-4, Math.min(4, dw)) * 0.02
      }
      res.rgba[i * 4] = base[i * 3] * f
      res.rgba[i * 4 + 1] = base[i * 3 + 1] * f
      res.rgba[i * 4 + 2] = base[i * 3 + 2] * f
      res.rgba[i * 4 + 3] = 255
    }
  paintTrace(res, builtMask)
  paintLod(res)
  return res
}

/** Grobes Höhenfeld für die Ferne: je Zelle der höchste Block und seine (schattierte) Farbe. */
function paintLod(res: TileResult): void {
  const f = TILE / TRACE
  for (let tz = 0; tz < TRACE; tz++)
    for (let tx = 0; tx < TRACE; tx++) {
      let best = -1, bh = NO_SURFACE
      for (let z = 0; z < f; z++)
        for (let x = 0; x < f; x++) {
          const i = tx * f + x + (tz * f + z) * TILE
          const h = res.heights[i]
          if (h !== NO_SURFACE && (best < 0 || h > bh)) {
            best = i
            bh = h
          }
        }
      if (best < 0) continue
      const c = tx + tz * TRACE
      res.lodH[c] = bh
      res.lodC[c * 3] = res.rgba[best * 4]
      res.lodC[c * 3 + 1] = res.rgba[best * 4 + 1]
      res.lodC[c * 3 + 2] = res.rgba[best * 4 + 2]
    }
}

/** Spuren: Chunks, in denen ihr lange wart, leicht eingefärbt; gebaute Blöcke kräftig. */
function paintTrace(res: TileResult, builtMask: Uint8Array): void {
  const [ar, ag, ab] = [127, 95, 232]
  const f = TILE / TRACE
  for (let tz = 0; tz < TRACE; tz++)
    for (let tx = 0; tx < TRACE; tx++) {
      let built = false
      for (let z = 0; z < f && !built; z++)
        for (let x = 0; x < f; x++)
          if (builtMask[tx * f + x + (tz * f + z) * TILE]) {
            built = true
            break
          }
      const secs = res.inhabited[((tx * f) >> 4) + ((tz * f) >> 4) * 32]
      // 1 Minute → kaum sichtbar, 10 Stunden → deutlich
      const a = built ? 230 : secs < 60 ? 0 : Math.min(110, 18 + Math.log10(secs / 60) * 40)
      if (!a) continue
      const o = (tx + tz * TRACE) * 4
      res.trace[o] = ar; res.trace[o + 1] = ag; res.trace[o + 2] = ab; res.trace[o + 3] = a
    }
}

const WATER: RGB = [63, 118, 228]

const nameMemo = new Map<string, string>()
function nameOf(state: string): string {
  let n = nameMemo.get(state)
  if (n === undefined) nameMemo.set(state, (n = parseState(state).name))
  return n
}
const waterMemo = new Map<string, boolean>()
function watery(name: string): boolean {
  let v = waterMemo.get(name)
  if (v === undefined) waterMemo.set(name, (v = isWaterLike(name)))
  return v
}

const naturalMemo = new Map<string, boolean>()
function natural(name: string): boolean {
  let v = naturalMemo.get(name)
  if (v === undefined) naturalMemo.set(name, (v = isNatural(name) || /_log$|_wood$|snow|ice$|sapling|vine|bush|mushroom|coral|sea_pickle|pale_(moss|hanging)|eyeblossom|cactus_flower|dry_grass|mangrove_roots|propagule|bee_nest|cobweb|sculk|suspicious|frogspawn|resin_clump|creaking_heart|dripleaf/.test(name)))
  return v
}

/** Malt einen Chunk und liefert, wie viele Spalten oben gebaut sind. */
function paintChunk(c: ChunkData, ox: number, oz: number, heights: Int16Array, base: Uint8ClampedArray, water: Uint8Array, builtMask: Uint8Array, color: ColorFn): number {
  let built = 0
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const s = c.surface[x + z * 16]
      if (s === NO_SURFACE) continue
      let y = s - 1
      let state = blockAt(c, x, y, z)
      const i = ox + x + (oz + z) * TILE
      let rgb: RGB
      if (watery(nameOf(state))) {
        let depth = 0
        while (depth < 32 && y > c.minY && watery(nameOf(state))) {
          y--
          depth++
          state = blockAt(c, x, y, z)
        }
        const floor = color(nameOf(state))
        const t = 0.82
        rgb = [WATER[0] * t + floor[0] * (1 - t), WATER[1] * t + floor[1] * (1 - t), WATER[2] * t + floor[2] * (1 - t)]
        water[i] = depth
        heights[i] = s - 1
      } else {
        const name = nameOf(state)
        rgb = color(name)
        heights[i] = y
        if (!natural(name)) {
          builtMask[i] = 1
          built++
        }
      }
      base[i * 3] = rgb[0]
      base[i * 3 + 1] = rgb[1]
      base[i * 3 + 2] = rgb[2]
    }
  return built
}
