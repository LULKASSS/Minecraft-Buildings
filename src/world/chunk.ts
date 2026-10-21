// Chunk-Format ab 1.18 (gilt so auch in 26.x): sections[] mit block_states {palette, data}, Heightmaps.
// Ältere Chunks (mit "Level"-Tag) erkennt die App, liest sie aber nicht.

import { AIR, formatState, isAir, type BlockState } from '../blueprint/blockstate'
import { readNbt, unpackAligned, type NbtObject } from './nbt-fast'

export interface Section {
  palette: BlockState[]
  data: Uint16Array | null // null: alles palette[0] (oder noch gepackt, siehe raw)
  /** noch gepackte Indizes; werden beim ersten Zugriff entpackt */
  raw?: Int32Array
  bits?: number
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
  /** Wie lange Spieler insgesamt in diesem Chunk waren, in Sekunden (aus InhabitedTime) */
  inhabited: number
}

export type ChunkResult = { ok: true; chunk: ChunkData } | { ok: false; reason: 'legacy' | 'incomplete' }

export const NO_SURFACE = -32768

export function decodeChunk(bytes: Uint8Array): ChunkResult {
  const root = readNbt(bytes)
  if (root.Level) return { ok: false, reason: 'legacy' }
  const status = String(root.Status ?? '')
  if (status && status !== 'minecraft:full' && status !== 'full') return { ok: false, reason: 'incomplete' }

  const rawSections = (root.sections as NbtObject[] | undefined) ?? []
  // Unterkante der Welt aus yPos. Abschnitte nur mit Licht (z. B. Y = -5 und 20) zählen nicht mit,
  // sonst verschiebt sich alles um 16 Blöcke.
  const hasY = typeof root.yPos === 'number'
  let minSec = hasY ? (root.yPos as number) : Infinity
  let maxSec = -Infinity
  for (const s of rawSections) {
    if (!s.block_states) continue
    const y = Number(s.Y)
    if (!hasY && y < minSec) minSec = y
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
    const sec: Section = { palette: pal, data: null }
    if (pal.length > 1 && bs.data instanceof Int32Array) {
      sec.raw = bs.data
      sec.bits = Math.max(4, Math.ceil(Math.log2(pal.length)))
    }
    const i = Number(s.Y) - minSec
    if (i >= 0 && i < count) sections[i] = sec
  }

  const chunk: ChunkData = {
    cx: Number(root.xPos),
    cz: Number(root.zPos),
    minY: minSec * 16,
    height: count * 16,
    sections,
    surface: new Int16Array(256).fill(NO_SURFACE),
    dataVersion: Number(root.DataVersion ?? 0),
    inhabited: Number(root.InhabitedTime ?? 0) / 20,
  }

  const hm = (root.Heightmaps as NbtObject | undefined)?.WORLD_SURFACE
  if (hm instanceof Int32Array && hm.length > 0) {
    // Bitbreite hängt an der Höhe der Dimension (384 → 9), nicht an den gespeicherten Abschnitten:
    // aus der Zahl der Longs zurückrechnen.
    const raw = unpackAligned(hm, heightmapBits(hm.length / 2), 256)
    for (let i = 0; i < 256; i++) chunk.surface[i] = raw[i] === 0 ? NO_SURFACE : chunk.minY + raw[i]
    // Heightmaps können veraltet oder verschoben sein (z. B. aus älteren Versionen übernommene Chunks).
    // Dann würde das Gelände mittendrin abgeschnitten. Deshalb jede Spalte gegenprüfen und sonst nachrechnen.
    const topY = chunk.minY + chunk.height
    for (let i = 0; i < 256; i++) {
      const x = i & 15, z = i >> 4, s = chunk.surface[i]
      const ok = s !== NO_SURFACE && s > chunk.minY && s <= topY && !isAir(blockAt(chunk, x, s - 1, z)) && (s >= topY || isAir(blockAt(chunk, x, s, z)))
      if (!ok) chunk.surface[i] = scanColumn(chunk, x, z)
    }
  } else {
    computeSurface(chunk)
  }
  return { ok: true, chunk }
}

/** Oberster Block einer Spalte (+1), leere Abschnitte werden übersprungen. */
function scanColumn(c: ChunkData, x: number, z: number): number {
  for (let si = c.sections.length - 1; si >= 0; si--) {
    const sec = c.sections[si]
    if (!sec || (sec.palette.length === 1 && isAir(sec.palette[0]))) continue
    const base = c.minY + si * 16
    for (let y = base + 15; y >= base; y--) if (!isAir(blockAt(c, x, y, z))) return y + 1
  }
  return NO_SURFACE
}

/** Bitbreite einer Heightmap mit 256 Einträgen aus der Zahl der Longs (Einträge laufen nicht über Long-Grenzen). */
export function heightmapBits(longs: number): number {
  for (let b = 1; b <= 16; b++) if (Math.ceil(256 / Math.floor(64 / b)) === longs) return b
  return 9
}

function computeSurface(c: ChunkData): void {
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.surface[x + z * 16] = scanColumn(c, x, z)
}

/** Block an lokaler Position x,z (0…15) und Welt-Y. */
export function blockAt(c: ChunkData, x: number, y: number, z: number): BlockState {
  const si = (y - c.minY) >> 4
  const s = c.sections[si]
  if (!s) return AIR
  if (s.raw) {
    s.data = unpackAligned(s.raw, s.bits!, 4096)
    s.raw = undefined
  }
  if (!s.data) return s.palette[0]
  return s.palette[s.data[((y & 15) << 8) | (z << 4) | x]] ?? AIR
}
