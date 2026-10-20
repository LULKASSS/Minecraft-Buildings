// Chunk-Format ab 1.18 (gilt so auch in 26.x): sections[] mit block_states {palette, data}, Heightmaps.
// Ältere Chunks (mit "Level"-Tag) erkennt die App, liest sie aber nicht.

import { AIR, formatState, isAir, type BlockState } from '../blueprint/blockstate'
import { readNbt, unpackAligned, type NbtObject } from './nbt-fast'

export interface Section {
  palette: BlockState[]
  data: Uint16Array | null // null: alles palette[0]
}

export interface ChunkData {
  cx: number
  cz: number
  minY: number
  height: number
  sections: (Section | undefined)[]
  /** WORLD_SURFACE: Y über dem obersten Nicht-Luft-Block je Spalte (x + z*16), aus der Heightmap oder berechnet. */
  surface: Int16Array
  dataVersion: number
}

export type ChunkResult = { ok: true; chunk: ChunkData } | { ok: false; reason: 'legacy' | 'incomplete' }

export const NO_SURFACE = -32768

export function decodeChunk(bytes: Uint8Array): ChunkResult {
  const root = readNbt(bytes)
  if (root.Level) return { ok: false, reason: 'legacy' }
  const status = String(root.Status ?? '')
  if (status && status !== 'minecraft:full' && status !== 'full') return { ok: false, reason: 'incomplete' }

  const rawSections = (root.sections as NbtObject[] | undefined) ?? []
  let minSec = typeof root.yPos === 'number' ? root.yPos : Infinity
  let maxSec = -Infinity
  for (const s of rawSections) {
    const y = Number(s.Y)
    if (y < minSec) minSec = y
    if (y > maxSec) maxSec = y
  }
  if (!Number.isFinite(minSec)) minSec = -4
  if (!Number.isFinite(maxSec)) maxSec = minSec
  const count = maxSec - minSec + 1
  const sections: (Section | undefined)[] = new Array(count)
  for (const s of rawSections) {
    const bs = s.block_states as NbtObject | undefined
    if (!bs) continue
    const pal = ((bs.palette as NbtObject[]) ?? []).map(e => {
      const props = (e.Properties as Record<string, string> | undefined) ?? {}
      return formatState(String(e.Name), props)
    })
    if (pal.length === 0) continue
    let data: Uint16Array | null = null
    if (pal.length > 1 && bs.data instanceof Int32Array) {
      const bits = Math.max(4, Math.ceil(Math.log2(pal.length)))
      data = unpackAligned(bs.data, bits, 4096)
    }
    sections[Number(s.Y) - minSec] = { palette: pal, data }
  }

  const chunk: ChunkData = {
    cx: Number(root.xPos),
    cz: Number(root.zPos),
    minY: minSec * 16,
    height: count * 16,
    sections,
    surface: new Int16Array(256).fill(NO_SURFACE),
    dataVersion: Number(root.DataVersion ?? 0),
  }

  const hm = (root.Heightmaps as NbtObject | undefined)?.WORLD_SURFACE
  if (hm instanceof Int32Array && hm.length > 0) {
    const bits = Math.ceil(Math.log2(chunk.height + 1))
    const raw = unpackAligned(hm, bits, 256)
    for (let i = 0; i < 256; i++) chunk.surface[i] = raw[i] === 0 ? NO_SURFACE : chunk.minY + raw[i]
  } else {
    computeSurface(chunk)
  }
  return { ok: true, chunk }
}

function computeSurface(c: ChunkData): void {
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      for (let y = c.minY + c.height - 1; y >= c.minY; y--) {
        if (!isAir(blockAt(c, x, y, z))) {
          c.surface[x + z * 16] = y + 1
          break
        }
      }
    }
}

/** Block an lokaler Position x,z (0…15) und Welt-Y. */
export function blockAt(c: ChunkData, x: number, y: number, z: number): BlockState {
  const si = (y - c.minY) >> 4
  const s = c.sections[si]
  if (!s) return AIR
  if (!s.data) return s.palette[0]
  return s.palette[s.data[((y & 15) << 8) | (z << 4) | x]] ?? AIR
}
