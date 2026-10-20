// Schneller NBT-Leser nur für Chunks: liefert einfache Objekte, Long-Arrays als Int32Array (hi, lo, hi, lo …)
// und überspringt Teile, die die App nicht braucht. deepslate legt pro Long ein Objekt an,
// das ist bei 1024 Chunks pro Region zu langsam.

export type NbtValue = number | bigint | string | Int8Array | Int32Array | NbtValue[] | NbtObject
export interface NbtObject {
  [key: string]: NbtValue
}

const SKIP_DEFAULT = new Set([
  'block_entities', 'structures', 'PostProcessing', 'blending_data', 'block_ticks', 'fluid_ticks',
  'Lights', 'CarvingMasks', 'Entities', 'entities', 'BlockLight', 'SkyLight', 'UpgradeData', 'biomes',
])

const decoder = new TextDecoder()

export function readNbt(bytes: Uint8Array, skip: Set<string> = SKIP_DEFAULT): NbtObject {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 0

  const str = (): string => {
    const len = view.getUint16(p)
    p += 2
    const s = decoder.decode(bytes.subarray(p, p + len))
    p += len
    return s
  }

  const payload = (type: number, keep: boolean): NbtValue => {
    switch (type) {
      case 1: { const v = view.getInt8(p); p += 1; return v }
      case 2: { const v = view.getInt16(p); p += 2; return v }
      case 3: { const v = view.getInt32(p); p += 4; return v }
      case 4: { const v = view.getBigInt64(p); p += 8; return v }
      case 5: { const v = view.getFloat32(p); p += 4; return v }
      case 6: { const v = view.getFloat64(p); p += 8; return v }
      case 7: {
        const n = view.getInt32(p); p += 4
        const v = keep ? new Int8Array(bytes.buffer.slice(bytes.byteOffset + p, bytes.byteOffset + p + n)) : new Int8Array(0)
        p += n
        return v
      }
      case 8: return str()
      case 9: {
        const t = view.getUint8(p); p += 1
        const n = view.getInt32(p); p += 4
        const out: NbtValue[] = []
        for (let i = 0; i < n; i++) {
          const v = payload(t, keep)
          if (keep) out.push(v)
        }
        return out
      }
      case 10: {
        const obj: NbtObject = {}
        for (;;) {
          const t = view.getUint8(p); p += 1
          if (t === 0) break
          const name = str()
          const k = keep && !skip.has(name)
          const v = payload(t, k)
          if (k) obj[name] = v
        }
        return obj
      }
      case 11: return ints(1, keep)
      case 12: return ints(2, keep)
      default: throw new Error(`Unbekannter NBT-Typ ${type}`)
    }
  }

  const ints = (per: number, keep: boolean): Int32Array => {
    const n = view.getInt32(p) * per; p += 4
    if (!keep) { p += n * 4; return new Int32Array(0) }
    const out = new Int32Array(n)
    for (let i = 0; i < n; i++, p += 4) out[i] = view.getInt32(p)
    return out
  }

  const type = view.getUint8(p); p += 1
  if (type !== 10) throw new Error('NBT beginnt nicht mit einem Compound')
  str()
  return payload(10, true) as NbtObject
}

/** Wert aus gepackten Longs, bei denen kein Eintrag über eine Long-Grenze läuft (Chunk-Format ab 1.16). */
export function unpackAligned(longs: Int32Array, bits: number, count: number, out?: Uint16Array): Uint16Array {
  const res = out ?? new Uint16Array(count)
  const perLong = Math.floor(64 / bits)
  const mask = (1 << bits) - 1
  for (let i = 0; i < count; i++) {
    const li = (i / perLong) | 0
    const o = (i - li * perLong) * bits
    const hi = longs[li * 2] >>> 0
    const lo = longs[li * 2 + 1] >>> 0
    let v: number
    if (o + bits <= 32) v = lo >>> o
    else if (o >= 32) v = hi >>> (o - 32)
    else v = (lo >>> o) | (hi << (32 - o))
    res[i] = v & mask
  }
  return res
}
