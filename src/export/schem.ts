// Export als Sponge-Schematic Version 3 (.schem), z. B. für WorldEdit.

import { NbtByteArray, NbtCompound, NbtFile, NbtInt, NbtIntArray, NbtList, NbtLong, NbtShort, NbtString } from 'deepslate/nbt'
import type { Blueprint } from '../blueprint/blueprint'
import type { ExportMeta } from './litematic'

export function varints(values: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length; i++) {
    let v = values[i]
    while (v >= 0x80) {
      out.push((v & 0x7f) | 0x80)
      v >>>= 7
    }
    out.push(v)
  }
  // Als vorzeichenbehaftete Bytes für das NBT-Byte-Array
  return out.map(b => (b > 127 ? b - 256 : b))
}

export function readVarints(bytes: ArrayLike<number>, count: number): number[] {
  const out: number[] = []
  let i = 0
  while (out.length < count) {
    let v = 0, shift = 0, b: number
    do {
      b = bytes[i++] & 0xff
      v |= (b & 0x7f) << shift
      shift += 7
    } while (b & 0x80)
    out.push(v)
  }
  return out
}

export function writeSchem(bp: Blueprint, meta: ExportMeta): Uint8Array {
  const { palette, blocks } = bp.compact()
  const [w, h, d] = bp.size
  const pal = new NbtCompound()
  palette.forEach((s, i) => pal.set(s, new NbtInt(i)))

  const schematic = new NbtCompound()
    .set('Version', new NbtInt(3))
    .set('DataVersion', new NbtInt(meta.dataVersion))
    .set('Width', new NbtShort(w))
    .set('Height', new NbtShort(h))
    .set('Length', new NbtShort(d))
    .set('Offset', new NbtIntArray([0, 0, 0]))
    .set('Metadata', new NbtCompound()
      .set('Name', new NbtString(meta.name))
      .set('Author', new NbtString(meta.author ?? 'Basenplaner'))
      .set('Date', new NbtLong(BigInt(meta.now ?? Date.now()))))
    .set('Blocks', new NbtCompound()
      .set('Palette', pal)
      .set('Data', new NbtByteArray(varints(blocks)))
      .set('BlockEntities', new NbtList([], 10)))

  const root = new NbtCompound().set('Schematic', schematic)
  return new NbtFile('', root, 'gzip', false, undefined).write()
}
