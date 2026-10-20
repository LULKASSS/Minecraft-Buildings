// Export als .litematic (Litematica, Schematic-Version 7).
// Aufbau nach LitematicaSchematic.java (Litematica 1.21.11): gzip-NBT mit Metadata und einer Region.
// Die Indizes liegen dicht gepackt und laufen über Long-Grenzen hinweg (anders als in Chunks).

import { NbtCompound, NbtFile, NbtInt, NbtList, NbtLong, NbtLongArray, NbtString } from 'deepslate/nbt'
import { parseState } from '../blueprint/blockstate'
import type { Blueprint } from '../blueprint/blueprint'

export const LITEMATIC_VERSION = 7
export const LITEMATIC_SUBVERSION = 1

export function bitsFor(paletteSize: number): number {
  return Math.max(2, Math.ceil(Math.log2(Math.max(paletteSize, 1))))
}

/** Packt Werte wie LitematicaBitArray. Ergebnis als vorzeichenbehaftete 64-Bit-Zahlen. */
export function packLitematica(values: ArrayLike<number>, bits: number): BigInt64Array {
  const total = values.length * bits
  const longs = new BigUint64Array(Math.ceil(total / 64))
  const mask = (1n << BigInt(bits)) - 1n
  for (let i = 0; i < values.length; i++) {
    const v = BigInt(values[i]) & mask
    const start = i * bits
    const li = start >> 6
    const off = start & 63
    longs[li] |= (v << BigInt(off)) & 0xffffffffffffffffn
    const endLi = (start + bits - 1) >> 6
    if (endLi !== li) longs[endLi] |= v >> BigInt(64 - off)
  }
  return new BigInt64Array(longs.buffer)
}

export function unpackLitematica(longs: ArrayLike<bigint>, bits: number, count: number): Uint16Array {
  const u = new BigUint64Array(longs.length)
  for (let i = 0; i < longs.length; i++) u[i] = BigInt.asUintN(64, longs[i])
  const out = new Uint16Array(count)
  const mask = (1n << BigInt(bits)) - 1n
  for (let i = 0; i < count; i++) {
    const start = i * bits
    const li = start >> 6
    const off = start & 63
    let v = u[li] >> BigInt(off)
    const endLi = (start + bits - 1) >> 6
    if (endLi !== li) v |= u[endLi] << BigInt(64 - off)
    out[i] = Number(v & mask)
  }
  return out
}

function vec(x: number, y: number, z: number): NbtCompound {
  return new NbtCompound().set('x', new NbtInt(x)).set('y', new NbtInt(y)).set('z', new NbtInt(z))
}

export interface ExportMeta {
  name: string
  author?: string
  description?: string
  dataVersion: number
  now?: number
}

export function writeLitematic(bp: Blueprint, meta: ExportMeta): Uint8Array {
  const { palette, blocks } = bp.compact()
  const [w, h, d] = bp.size
  const bits = bitsFor(palette.length)
  const now = BigInt(meta.now ?? Date.now())

  const paletteTag = new NbtList(palette.map(s => {
    const { name, props } = parseState(s)
    const c = new NbtCompound().set('Name', new NbtString(name))
    const keys = Object.keys(props)
    if (keys.length) {
      const p = new NbtCompound()
      for (const k of keys) p.set(k, new NbtString(props[k]))
      c.set('Properties', p)
    }
    return c
  }), 10)

  const region = new NbtCompound()
    .set('Position', vec(0, 0, 0))
    .set('Size', vec(w, h, d))
    .set('BlockStatePalette', paletteTag)
    .set('BlockStates', new NbtLongArray(Array.from(packLitematica(blocks, bits))))
    .set('TileEntities', new NbtList([], 10))
    .set('Entities', new NbtList([], 10))
    .set('PendingBlockTicks', new NbtList([], 10))
    .set('PendingFluidTicks', new NbtList([], 10))

  const metadata = new NbtCompound()
    .set('Name', new NbtString(meta.name))
    .set('Author', new NbtString(meta.author ?? 'Basenplaner'))
    .set('Description', new NbtString(meta.description ?? ''))
    .set('RegionCount', new NbtInt(1))
    .set('TotalVolume', new NbtInt(w * h * d))
    .set('TotalBlocks', new NbtInt(bp.count()))
    .set('TimeCreated', new NbtLong(now))
    .set('TimeModified', new NbtLong(now))
    .set('EnclosingSize', vec(w, h, d))

  const root = new NbtCompound()
    .set('MinecraftDataVersion', new NbtInt(meta.dataVersion))
    .set('Version', new NbtInt(LITEMATIC_VERSION))
    .set('SubVersion', new NbtInt(LITEMATIC_SUBVERSION))
    .set('Metadata', metadata)
    .set('Regions', new NbtCompound().set(regionName(meta.name), region))

  return new NbtFile('', root, 'gzip', false, undefined).write()
}

function regionName(name: string): string {
  return name.trim() || 'Bauwerk'
}
