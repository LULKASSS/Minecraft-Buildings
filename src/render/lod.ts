// Ferne in 3D: aus dem groben Höhenfeld einer Kartenkachel (4 × 4 Blöcke je Zelle) Säulen bauen.
// So sieht man von oben die ganze Umgebung bis zum Horizont, ohne jeden Block zu laden.
// Wo schon echte Blöcke geladen sind, blendet der Shader die Ferne über eine Maske aus.

import * as THREE from 'three'
import { NO_SURFACE } from '../world/chunk'
import { TILE, TRACE } from '../world/tile'

export const CELL = TILE / TRACE

export interface LodMesh {
  positions: Float32Array
  colors: Float32Array
  /** Mitte der Zelle, zu der eine Fläche gehört: danach fragt der Shader die Maske (keine Kanten-Fehler) */
  owner: Float32Array
  indices: Uint32Array
}

/** 32er-Stück = 8 Zellen: zusammengefasste Deckel enden an Stückgrenzen, damit die Maske sie ganz ausblendet. */
const PIECE_CELLS = 32 / (TILE / TRACE)

/**
 * Säulen einer Region, Koordinaten relativ zu base.
 * neighbor liefert die Höhe einer Zelle außerhalb der Region (Weltzellen-Koordinaten) oder null.
 */
export function buildLod(
  lodH: Int16Array, lodC: Uint8Array, rx: number, rz: number, base: [number, number, number],
  neighbor: (cx: number, cz: number) => number | null,
): LodMesh {
  const pos: number[] = [], col: number[] = [], own: number[] = [], idx: number[] = []
  const quad = (v: number[][], c: [number, number, number], ox: number, oz: number) => {
    const b = pos.length / 3
    for (const p of v) {
      pos.push(p[0], p[1], p[2])
      col.push(c[0], c[1], c[2])
      own.push(ox, oz)
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  const ox = rx * TILE - base[0], oz = rz * TILE - base[2], oy = -base[1]
  const hAt = (tx: number, tz: number): number | null => {
    if (tx >= 0 && tz >= 0 && tx < TRACE && tz < TRACE) {
      const h = lodH[tx + tz * TRACE]
      return h === NO_SURFACE ? null : h
    }
    return neighbor(rx * TRACE + tx, rz * TRACE + tz)
  }
  for (let tz = 0; tz < TRACE; tz++) {
    // Deckel: gleich hohe, gleichfarbige Zellen einer Reihe zusammenfassen (nicht über Stückgrenzen)
    let tx = 0
    while (tx < TRACE) {
      const i = tx + tz * TRACE
      const h = lodH[i]
      if (h === NO_SURFACE) {
        tx++
        continue
      }
      let end = tx + 1
      while (end < TRACE && end % PIECE_CELLS !== 0) {
        const j = end + tz * TRACE
        if (lodH[j] !== h || lodC[j * 3] !== lodC[i * 3] || lodC[j * 3 + 1] !== lodC[i * 3 + 1] || lodC[j * 3 + 2] !== lodC[i * 3 + 2]) break
        end++
      }
      const c: [number, number, number] = [lodC[i * 3] / 255, lodC[i * 3 + 1] / 255, lodC[i * 3 + 2] / 255]
      const y = h + 1 + oy
      const x0 = ox + tx * CELL, x1 = ox + end * CELL, z0 = oz + tz * CELL, z1 = z0 + CELL
      quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], c, (x0 + x1) / 2, (z0 + z1) / 2)
      tx = end
    }
    // Wände zu tieferen Nachbarn (gehören immer der höheren Zelle)
    for (let x = 0; x < TRACE; x++) {
      const i = x + tz * TRACE
      const h = lodH[i]
      if (h === NO_SURFACE) continue
      const top = h + 1 + oy
      const x0 = ox + x * CELL, x1 = x0 + CELL, z0 = oz + tz * CELL, z1 = z0 + CELL
      const base3: [number, number, number] = [lodC[i * 3] / 255, lodC[i * 3 + 1] / 255, lodC[i * 3 + 2] / 255]
      const sides: [number, number, number[][], number][] = [
        [1, 0, [[x1, 0, z1], [x1, 0, z0], [x1, 1, z0], [x1, 1, z1]], 0.6],
        [-1, 0, [[x0, 0, z0], [x0, 0, z1], [x0, 1, z1], [x0, 1, z0]], 0.6],
        [0, 1, [[x0, 0, z1], [x1, 0, z1], [x1, 1, z1], [x0, 1, z1]], 0.8],
        [0, -1, [[x1, 0, z0], [x0, 0, z0], [x0, 1, z0], [x1, 1, z0]], 0.8],
      ]
      for (const [dx, dz, v, sh] of sides) {
        const nh = hAt(x + dx, tz + dz)
        const bottom = (nh === null ? h - 8 : nh) + 1 + oy
        if (bottom >= top) continue
        quad(v.map(p => [p[0], p[1] ? top : bottom, p[2]]), [base3[0] * sh, base3[1] * sh, base3[2] * sh], x0 + CELL / 2, z0 + CELL / 2)
      }
    }
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), owner: new Float32Array(own), indices: new Uint32Array(idx) }
}

/** Maske: 1 Texel je 32er-Stück, 1 = dort liegen echte Blöcke, die Ferne wird ausgeblendet. */
export class DetailMask {
  static readonly SIZE = 128 // Stücke je Seite → 4096 Blöcke
  readonly data = new Uint8Array(DetailMask.SIZE * DetailMask.SIZE)
  readonly texture: THREE.DataTexture
  /** linke obere Ecke in Szenenkoordinaten */
  origin = new THREE.Vector2()

  constructor(readonly piece: number) {
    this.texture = new THREE.DataTexture(this.data, DetailMask.SIZE, DetailMask.SIZE, THREE.RedFormat, THREE.UnsignedByteType)
    this.texture.magFilter = THREE.NearestFilter
    this.texture.minFilter = THREE.NearestFilter
    this.texture.needsUpdate = true
  }

  /** Maske um die Szenenmitte legen (base = Mitte). */
  center(): void {
    const half = (DetailMask.SIZE * this.piece) / 2
    this.origin.set(-half, -half)
    this.data.fill(0)
    this.texture.needsUpdate = true
  }

  set(sceneX: number, sceneZ: number, on: boolean): void {
    const i = Math.floor((sceneX - this.origin.x) / this.piece), j = Math.floor((sceneZ - this.origin.y) / this.piece)
    if (i < 0 || j < 0 || i >= DetailMask.SIZE || j >= DetailMask.SIZE) return
    this.data[i + j * DetailMask.SIZE] = on ? 255 : 0
    this.texture.needsUpdate = true
  }
}

export function lodMaterial(mask: DetailMask): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    fog: false,
    uniforms: {
      mask: { value: mask.texture },
      maskOrigin: { value: mask.origin },
      maskSize: { value: DetailMask.SIZE * mask.piece },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 300 },
      fogFar: { value: 2500 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 owner;
      varying vec3 vColor;
      varying vec2 vXZ;
      varying float vDepth;
      void main() {
        vColor = color;
        vXZ = owner;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D mask;
      uniform vec2 maskOrigin;
      uniform float maskSize;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      varying vec3 vColor;
      varying vec2 vXZ;
      varying float vDepth;
      void main() {
        vec2 m = (vXZ - maskOrigin) / maskSize;
        if (m.x >= 0.0 && m.y >= 0.0 && m.x < 1.0 && m.y < 1.0 && texture2D(mask, m).r > 0.5) discard;
        // etwas dunkler: die Kartenfarbe ist ein Mittel, echte Texturen wirken in der Nähe satter
        gl_FragColor = vec4(mix(vColor * 0.88, fogColor, smoothstep(fogNear, fogFar, vDepth)), 1.0);
        #include <colorspace_fragment>
      }`,
  })
}
