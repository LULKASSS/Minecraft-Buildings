// Region-Dateien (.mca) lesen, ohne die ganze Datei zu laden.
// Kopf: 1024 × 4 Byte Lage (3 Byte Sektor, 1 Byte Länge), dann 1024 × 4 Byte Zeitstempel.
// Chunk: 4 Byte Länge, 1 Byte Kompression (1 gzip, 2 zlib, 3 roh, 4 LZ4; +128 = ausgelagert in c.X.Z.mcc).

import { inflate, ungzip } from 'pako'

const SECTOR = 4096

export class RegionError extends Error {}

export interface RegionHeader {
  offsets: Uint32Array // Sektor-Start, 0 = Chunk fehlt
  sectors: Uint8Array
  timestamps: Uint32Array
}

export async function readHeader(blob: Blob): Promise<RegionHeader> {
  if (blob.size < 2 * SECTOR) return { offsets: new Uint32Array(1024), sectors: new Uint8Array(1024), timestamps: new Uint32Array(1024) }
  const view = new DataView(await blob.slice(0, 2 * SECTOR).arrayBuffer())
  const offsets = new Uint32Array(1024)
  const sectors = new Uint8Array(1024)
  const timestamps = new Uint32Array(1024)
  for (let i = 0; i < 1024; i++) {
    const loc = view.getUint32(i * 4)
    offsets[i] = loc >>> 8
    sectors[i] = loc & 0xff
    timestamps[i] = view.getUint32(SECTOR + i * 4)
  }
  return { offsets, sectors, timestamps }
}

export function chunkIndex(cx: number, cz: number): number {
  return (cx & 31) + (cz & 31) * 32
}

export type ExternalChunk = (cx: number, cz: number) => Promise<Blob | null>

/** Liefert die unkomprimierten NBT-Bytes eines Chunks oder null, wenn er nicht existiert. */
export async function readChunkBytes(
  blob: Blob,
  header: RegionHeader,
  cx: number,
  cz: number,
  external?: ExternalChunk,
): Promise<Uint8Array | null> {
  const i = chunkIndex(cx, cz)
  const start = header.offsets[i] * SECTOR
  if (header.offsets[i] === 0 || start + 5 > blob.size) return null
  const head = new DataView(await blob.slice(start, start + 5).arrayBuffer())
  const length = head.getUint32(0)
  const type = head.getUint8(4)
  let data: Uint8Array
  if (type & 0x80) {
    const ext = external ? await external(cx, cz) : null
    if (!ext) throw new RegionError(`Chunk ${cx} ${cz} ist ausgelagert, die .mcc-Datei fehlt`)
    data = new Uint8Array(await ext.arrayBuffer())
  } else {
    if (length < 1) return null
    data = new Uint8Array(await blob.slice(start + 5, start + 4 + length).arrayBuffer())
  }
  return decompress(data, type & 0x7f, cx, cz)
}

export function decompress(data: Uint8Array, type: number, cx = 0, cz = 0): Uint8Array {
  switch (type) {
    case 1: return ungzip(data)
    case 2: return inflate(data)
    case 3: return data
    case 4: throw new RegionError(`Chunk ${cx} ${cz} ist mit LZ4 gespeichert (Server-Einstellung region-file-compression). Das liest die App noch nicht.`)
    default: throw new RegionError(`Chunk ${cx} ${cz}: unbekannte Kompression ${type}`)
  }
}

/** Region einmal ganz in den Speicher lesen – viel schneller als tausend kleine Lesezugriffe. */
export interface LoadedRegion {
  buf: Uint8Array
  header: RegionHeader
}

export async function loadRegion(blob: Blob): Promise<LoadedRegion> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  if (buf.length < 2 * SECTOR) return { buf, header: { offsets: new Uint32Array(1024), sectors: new Uint8Array(1024), timestamps: new Uint32Array(1024) } }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const offsets = new Uint32Array(1024), sectors = new Uint8Array(1024), timestamps = new Uint32Array(1024)
  for (let i = 0; i < 1024; i++) {
    const loc = view.getUint32(i * 4)
    offsets[i] = loc >>> 8
    sectors[i] = loc & 0xff
    timestamps[i] = view.getUint32(SECTOR + i * 4)
  }
  return { buf, header: { offsets, sectors, timestamps } }
}

/** Chunk aus einer geladenen Region; ausgelagerte Chunks (.mcc) über external. */
export async function chunkFrom(r: LoadedRegion, cx: number, cz: number, external?: ExternalChunk): Promise<Uint8Array | null> {
  const i = chunkIndex(cx, cz)
  const start = r.header.offsets[i] * SECTOR
  if (r.header.offsets[i] === 0 || start + 5 > r.buf.length) return null
  const view = new DataView(r.buf.buffer, r.buf.byteOffset + start, 5)
  const length = view.getUint32(0)
  const type = view.getUint8(4)
  if (type & 0x80) {
    const ext = external ? await external(cx, cz) : null
    if (!ext) throw new RegionError(`Chunk ${cx} ${cz} ist ausgelagert, die .mcc-Datei fehlt`)
    return decompress(new Uint8Array(await ext.arrayBuffer()), type & 0x7f, cx, cz)
  }
  if (length < 1 || start + 4 + length > r.buf.length) return null
  return decompress(r.buf.subarray(start + 5, start + 4 + length), type & 0x7f, cx, cz)
}
