// Kartenkachel = eine Region (512 × 512 Blöcke). Farbe des obersten Blocks, Höhen leicht schattiert.
// Läuft im Worker, ist aber reine Rechnung und damit testbar.

import { parseState } from '../blueprint/blockstate'
import { fallbackColor, isWaterLike, type RGB } from '../render/block-colors'
import { blockAt, decodeChunk, NO_SURFACE, type ChunkData } from './chunk'
import { readChunkBytes, readHeader, type ExternalChunk } from './region'

export const TILE = 512

export interface TileResult {
  rgba: Uint8ClampedArray
  heights: Int16Array // Y des obersten Blocks je Spalte (x + z*512), NO_SURFACE = kein Chunk
  chunks: number
  skipped: { legacy: number; incomplete: number; errors: string[] }
}

export type ColorFn = (name: string) => RGB

export async function renderTile(blob: Blob, rx: number, rz: number, color: ColorFn = fallbackColor, external?: ExternalChunk): Promise<TileResult> {
  const header = await readHeader(blob)
  const heights = new Int16Array(TILE * TILE).fill(NO_SURFACE)
  const base = new Uint8ClampedArray(TILE * TILE * 3)
  const water = new Uint8Array(TILE * TILE) // Wassertiefe, 0 = kein Wasser
  const res: TileResult = { rgba: new Uint8ClampedArray(TILE * TILE * 4), heights, chunks: 0, skipped: { legacy: 0, incomplete: 0, errors: [] } }

  for (let lz = 0; lz < 32; lz++)
    for (let lx = 0; lx < 32; lx++) {
      const cx = rx * 32 + lx, cz = rz * 32 + lz
      let chunk: ChunkData
      try {
        const bytes = await readChunkBytes(blob, header, cx, cz, external)
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
      paintChunk(chunk, lx * 16, lz * 16, heights, base, water, color)
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
  return res
}

const WATER: RGB = [63, 118, 228]

function paintChunk(c: ChunkData, ox: number, oz: number, heights: Int16Array, base: Uint8ClampedArray, water: Uint8Array, color: ColorFn): void {
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const s = c.surface[x + z * 16]
      if (s === NO_SURFACE) continue
      let y = s - 1
      let state = blockAt(c, x, y, z)
      const i = ox + x + (oz + z) * TILE
      let rgb: RGB
      if (isWaterLike(parseState(state).name)) {
        let depth = 0
        while (depth < 32 && y > c.minY && isWaterLike(parseState(state).name)) {
          y--
          depth++
          state = blockAt(c, x, y, z)
        }
        const floor = color(parseState(state).name)
        const t = 0.82
        rgb = [WATER[0] * t + floor[0] * (1 - t), WATER[1] * t + floor[1] * (1 - t), WATER[2] * t + floor[2] * (1 - t)]
        water[i] = depth
        heights[i] = s - 1
      } else {
        rgb = color(parseState(state).name)
        heights[i] = y
      }
      base[i * 3] = rgb[0]
      base[i * 3 + 1] = rgb[1]
      base[i * 3 + 2] = rgb[2]
    }
}
