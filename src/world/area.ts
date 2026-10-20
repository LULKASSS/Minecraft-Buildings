// Gelände-Ausschnitt für die 3D-Ansicht: alle Blöcke in einem Quader, als Palette + Indizes.

import { AIR, type BlockState } from '../blueprint/blockstate'
import { blockAt, decodeChunk, type ChunkData } from './chunk'
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

export async function readArea(regions: RegionBlob[], box: Box3): Promise<AreaResult> {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1, d = box.z1 - box.z0 + 1
  const palette: BlockState[] = [AIR]
  const lookup = new Map<BlockState, number>([[AIR, 0]])
  const data = new Uint16Array(w * h * d)
  const headers = new Map<string, Awaited<ReturnType<typeof readHeader>>>()
  let missing = 0

  for (let cz = box.z0 >> 4; cz <= box.z1 >> 4; cz++)
    for (let cx = box.x0 >> 4; cx <= box.x1 >> 4; cx++) {
      const reg = regions.find(r => r.rx === cx >> 5 && r.rz === cz >> 5)
      if (!reg) { missing++; continue }
      const key = `${reg.rx},${reg.rz}`
      let header = headers.get(key)
      if (!header) headers.set(key, (header = await readHeader(reg.blob)))
      let chunk: ChunkData | null = null
      try {
        const bytes = await readChunkBytes(reg.blob, header, cx, cz, reg.external)
        const r = bytes ? decodeChunk(bytes) : null
        if (r?.ok) chunk = r.chunk
      } catch {
        chunk = null
      }
      if (!chunk) { missing++; continue }
      const xa = Math.max(box.x0, cx * 16), xb = Math.min(box.x1, cx * 16 + 15)
      const za = Math.max(box.z0, cz * 16), zb = Math.min(box.z1, cz * 16 + 15)
      for (let y = box.y0; y <= box.y1; y++)
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
            data[((y - box.y0) * d + (z - box.z0)) * w + (x - box.x0)] = p
          }
    }
  return { box, palette, data, missingChunks: missing }
}

/** Y des obersten festen Blocks einer Spalte im Ausschnitt (für Markierungen ohne Karte). */
export function surfaceInArea(a: AreaResult, x: number, z: number): number | null {
  const { box } = a
  const w = box.x1 - box.x0 + 1, d = box.z1 - box.z0 + 1
  for (let y = box.y1; y >= box.y0; y--) {
    if (a.data[((y - box.y0) * d + (z - box.z0)) * w + (x - box.x0)] !== 0) return y
  }
  return null
}
