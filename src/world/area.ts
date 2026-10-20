// Gelände-Ausschnitt für die 3D-Ansicht: alle Blöcke in einem Quader, als Palette + Indizes.
// Ohne feste Höhe (y0/y1 = NaN) nimmt der Leser die Spanne aus den Heightmaps:
// vom tiefsten obersten Block minus etwas Untergrund bis zum höchsten Block.

import { AIR, type BlockState } from '../blueprint/blockstate'
import { blockAt, decodeChunk, NO_SURFACE, type ChunkData } from './chunk'
import { readChunkBytes, readHeader, type ExternalChunk } from './region'

export interface Box3 {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number // einschließlich
}

export interface AreaResult {
  box: Box3
  palette: BlockState[]
  data: Uint16Array // (y * d + z) * w + x
  missingChunks: number
}

export interface RegionBlob {
  rx: number
  rz: number
  blob: Blob
  external?: ExternalChunk
}

/** Wie viel Untergrund unter dem tiefsten Oberflächenblock mitgeladen wird. */
export const UNDERGROUND = 6

export async function readArea(regions: RegionBlob[], box: Box3): Promise<AreaResult> {
  const headers = new Map<string, Awaited<ReturnType<typeof readHeader>>>()
  const chunks: ChunkData[] = []
  let missing = 0

  for (let cz = box.z0 >> 4; cz <= box.z1 >> 4; cz++)
    for (let cx = box.x0 >> 4; cx <= box.x1 >> 4; cx++) {
      const reg = regions.find(r => r.rx === cx >> 5 && r.rz === cz >> 5)
      if (!reg) { missing++; continue }
      const key = `${reg.rx},${reg.rz}`
      let header = headers.get(key)
      if (!header) headers.set(key, (header = await readHeader(reg.blob)))
      try {
        const bytes = await readChunkBytes(reg.blob, header, cx, cz, reg.external)
        const r = bytes ? decodeChunk(bytes) : null
        if (r?.ok) chunks.push(r.chunk)
        else missing++
      } catch {
        missing++
      }
    }

  const out: Box3 = { ...box }
  if (Number.isNaN(box.y0) || Number.isNaN(box.y1)) {
    let lo = Infinity, hi = -Infinity, minY = Infinity
    for (const c of chunks) {
      minY = Math.min(minY, c.minY)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const wx = c.cx * 16 + x, wz = c.cz * 16 + z
          if (wx < box.x0 || wx > box.x1 || wz < box.z0 || wz > box.z1) continue
          const s = c.surface[x + z * 16]
          if (s === NO_SURFACE) continue
          lo = Math.min(lo, s - 1)
          hi = Math.max(hi, s - 1)
        }
    }
    if (!Number.isFinite(lo)) { lo = 60; hi = 70; minY = -64 }
    if (Number.isNaN(box.y0)) out.y0 = Math.max(minY, lo - UNDERGROUND)
    if (Number.isNaN(box.y1)) out.y1 = hi
  }

  const w = out.x1 - out.x0 + 1, h = out.y1 - out.y0 + 1, d = out.z1 - out.z0 + 1
  const palette: BlockState[] = [AIR]
  const lookup = new Map<BlockState, number>([[AIR, 0]])
  const data = new Uint16Array(w * h * d)
  for (const chunk of chunks) {
    const xa = Math.max(out.x0, chunk.cx * 16), xb = Math.min(out.x1, chunk.cx * 16 + 15)
    const za = Math.max(out.z0, chunk.cz * 16), zb = Math.min(out.z1, chunk.cz * 16 + 15)
    for (let y = out.y0; y <= out.y1; y++)
      for (let z = za; z <= zb; z++)
        for (let x = xa; x <= xb; x++) {
          const s = blockAt(chunk, x & 15, y, z & 15)
          if (s === AIR) continue
          let p = lookup.get(s)
          if (p === undefined) {
            p = palette.length
            palette.push(s)
            lookup.set(s, p)
          }
          data[((y - out.y0) * d + (z - out.z0)) * w + (x - out.x0)] = p
        }
  }
  return { box: out, palette, data, missingChunks: missing }
}

export function areaGet(a: AreaResult, x: number, y: number, z: number): BlockState | null {
  const { box } = a
  if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1 || z < box.z0 || z > box.z1) return null
  const w = box.x1 - box.x0 + 1, d = box.z1 - box.z0 + 1
  const v = a.data[((y - box.y0) * d + (z - box.z0)) * w + (x - box.x0)]
  return v ? a.palette[v] : null
}

/** Y des obersten festen Blocks einer Spalte im Ausschnitt. */
export function surfaceInArea(a: AreaResult, x: number, z: number): number | null {
  for (let y = a.box.y1; y >= a.box.y0; y--) if (areaGet(a, x, y, z)) return y
  return null
}
