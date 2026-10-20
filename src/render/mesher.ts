// Baut aus Blöcken Dreiecke. Unabhängig von Three.js, damit es auch im Worker läuft.
// Einfarbig mit vereinfachten Formen; mit geladener .jar kommen die Flächen aus den echten Modellen (textured.ts).

import type { BlockState } from '../blueprint/blockstate'
import { fallbackColor, type RGB } from './block-colors'
import { isInvisible, isOpaqueCube, shapeOf } from './shapes'

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  uvs?: Float32Array
  indices: Uint32Array
}

export interface VoxelBlock {
  x: number
  y: number
  z: number
  state: BlockState
}

export interface MeshOptions {
  /** Ist an dieser Weltposition ein undurchsichtiger Würfel, der Flächen verdeckt? */
  occludes: (x: number, y: number, z: number) => boolean
  /** Deckel nie weglassen (für Schichten, deren obere Nachbarn ausgeblendet werden). */
  keepTop?: boolean
  /** Farbe überschreiben, z. B. für Gras und Laub nach Biom. */
  color?: (state: BlockState) => RGB
}

// Helligkeit je Seite wie im Spiel: oben hell, unten dunkel.
const SHADE = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 }

type Face = 'up' | 'down' | 'north' | 'south' | 'east' | 'west'
const FACES: { face: Face; n: [number, number, number] }[] = [
  { face: 'up', n: [0, 1, 0] }, { face: 'down', n: [0, -1, 0] },
  { face: 'north', n: [0, 0, -1] }, { face: 'south', n: [0, 0, 1] },
  { face: 'east', n: [1, 0, 0] }, { face: 'west', n: [-1, 0, 0] },
]

export class MeshBuilder {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []
  uv: number[] = []
  idx: number[] = []

  quad(v: number[][], n: [number, number, number], c: RGB, uv?: number[][]): void {
    const base = this.pos.length / 3
    for (let i = 0; i < 4; i++) {
      this.pos.push(v[i][0], v[i][1], v[i][2])
      this.nor.push(n[0], n[1], n[2])
      this.col.push(c[0], c[1], c[2])
      if (uv) this.uv.push(uv[i][0], uv[i][1])
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      colors: new Float32Array(this.col),
      uvs: this.uv.length ? new Float32Array(this.uv) : undefined,
      indices: new Uint32Array(this.idx),
    }
  }
}

function jitter(x: number, y: number, z: number): number {
  // Leichte, feste Schwankung je Block, damit Flächen nicht wie Plastik wirken.
  const h = Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791, 2654435761) >>> 0
  return 0.96 + (h % 1000) / 1000 * 0.08
}

export function meshFallback(blocks: Iterable<VoxelBlock>, opts: MeshOptions): MeshData {
  const mb = new MeshBuilder()
  for (const b of blocks) {
    if (isInvisible(b.state)) continue
    const rgb = (opts.color ?? fallbackColor)(b.state.split('[')[0])
    const j = jitter(b.x, b.y, b.z)
    for (const box of shapeOf(b.state)) {
      const [x0, y0, z0, x1, y1, z1] = box
      for (const { face, n } of FACES) {
        const onEdge =
          (face === 'up' && y1 === 1) || (face === 'down' && y0 === 0) ||
          (face === 'north' && z0 === 0) || (face === 'south' && z1 === 1) ||
          (face === 'west' && x0 === 0) || (face === 'east' && x1 === 1)
        if (onEdge && !(face === 'up' && opts.keepTop) && opts.occludes(b.x + n[0], b.y + n[1], b.z + n[2])) continue
        const s = SHADE[face] * j
        const c: RGB = [rgb[0] / 255 * s, rgb[1] / 255 * s, rgb[2] / 255 * s]
        mb.quad(faceVerts(face, b.x + x0, b.y + y0, b.z + z0, b.x + x1, b.y + y1, b.z + z1), n, c)
      }
    }
  }
  return mb.build()
}

/** Ecken einer Quaderseite, gegen den Uhrzeigersinn von außen gesehen. */
export function faceVerts(face: Face, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[][] {
  switch (face) {
    case 'up': return [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]
    case 'down': return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]
    case 'north': return [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]
    case 'south': return [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
    case 'east': return [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]
    case 'west': return [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]
  }
}

export { isOpaqueCube }
