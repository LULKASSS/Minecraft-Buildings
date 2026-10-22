// Grundriss aus Wolle (Fassung 15): Lukas legt im Spiel Wolle als Umriss oder Fläche. Daraus wird ein Haus,
// dessen Außenwände genau auf der Wolle stehen. Der Grundriss wird in Rechtecke zerlegt (größtes = Hauptbau,
// die anderen werden Anbauten mit eigenem Dach); die Tür kommt auf eine freie Seite des Hauptbaus, dafür wird gedreht.

import type { Vec3 } from '../blueprint/blueprint'
import type { Rotation } from '../blueprint/transform'

export interface Rect {
  x0: number
  z0: number
  w: number
  d: number
}

const key = (x: number, z: number) => `${x},${z}`

/** Umriss schließen: was von außen nicht erreichbar ist, gehört zur Fläche. Eine volle Fläche bleibt, wie sie ist. */
export function fillOutline(cells: [number, number][]): [number, number][] {
  const set = new Set(cells.map(([x, z]) => key(x, z)))
  const xs = cells.map(c => c[0]), zs = cells.map(c => c[1])
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1
  const outside = new Set<string>([key(x0, z0)])
  const queue: [number, number][] = [[x0, z0]]
  while (queue.length) {
    const [x, z] = queue.pop()!
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if (nx < x0 || nx > x1 || nz < z0 || nz > z1) continue
      const k = key(nx, nz)
      if (outside.has(k) || set.has(k)) continue
      outside.add(k)
      queue.push([nx, nz])
    }
  }
  const out: [number, number][] = []
  for (let z = z0 + 1; z < z1; z++) for (let x = x0 + 1; x < x1; x++) if (!outside.has(key(x, z))) out.push([x, z])
  return out
}

/** Größtes Rechteck in der Zellmenge (Histogramm je Zeile). */
function largestRect(set: Set<string>, x0: number, z0: number, w: number, d: number): Rect | null {
  const hgt = new Array(w).fill(0)
  let best: Rect | null = null
  for (let k = 0; k < d; k++) {
    for (let i = 0; i < w; i++) hgt[i] = set.has(key(x0 + i, z0 + k)) ? hgt[i] + 1 : 0
    for (let i = 0; i < w; i++) {
      let minH = Infinity
      for (let j = i; j < w && hgt[j] > 0; j++) {
        minH = Math.min(minH, hgt[j])
        const rw = j - i + 1
        if (rw < 3 || minH < 3) continue
        if (!best || rw * minH > best.w * best.d) best = { x0: x0 + i, z0: z0 + k - minH + 1, w: rw, d: minH }
      }
    }
  }
  return best
}

/** Fläche in Rechtecke von mindestens 3 × 3 zerlegen, größtes zuerst; Reste (schmale Streifen) zählen als übrig. */
export function rectsOf(cells: [number, number][], max = 6): { rects: Rect[]; leftover: number } {
  const set = new Set(cells.map(([x, z]) => key(x, z)))
  const xs = cells.map(c => c[0]), zs = cells.map(c => c[1])
  const x0 = Math.min(...xs), z0 = Math.min(...zs), w = Math.max(...xs) - x0 + 1, d = Math.max(...zs) - z0 + 1
  const rects: Rect[] = []
  while (rects.length < max) {
    const r = largestRect(set, x0, z0, w, d)
    if (!r) break
    rects.push(r)
    for (let z = r.z0; z < r.z0 + r.d; z++) for (let x = r.x0; x < r.x0 + r.w; x++) set.delete(key(x, z))
  }
  return { rects, leftover: set.size }
}

/** Drehung im Uhrzeigersinn (von oben, x Osten, z Süden) */
function rot(x: number, z: number, r: Rotation): [number, number] {
  switch (r) {
    case 90: return [-z, x]
    case 180: return [-x, -z]
    case 270: return [z, -x]
    default: return [x, z]
  }
}

export interface Fit {
  /** Rechtecke im Bauwerk (Hauptbau bei 0,0, Eingang an seiner Südseite) */
  footprint: Rect[]
  rotation: Rotation
  /** Weltposition des Ankers (Mitte des Hauptbaus) auf Höhe der Wolle */
  pos: Vec3
  leftover: number
}

/**
 * Haus auf Wollzellen (Welt x, z) auf Höhe y einpassen. Die Tür soll nach außen gehen: die erste Seite des
 * Hauptbaus (Süd, Ost, Nord, West), vor deren Mitte keine Wolle liegt, wird im Bauwerk zur Südseite.
 */
export function fitFootprint(cells: [number, number][], y: number): Fit | null {
  const area = fillOutline(cells)
  const { rects, leftover } = rectsOf(area)
  if (!rects.length) return null
  const set = new Set(area.map(([x, z]) => key(x, z)))
  const m = rects[0]
  const mx = m.x0 + (m.w >> 1), mz = m.z0 + (m.d >> 1)
  const sides: [Rotation, number, number][] = [
    [0, mx, m.z0 + m.d], // Süd
    [270, m.x0 + m.w, mz], // Ost
    [180, mx, m.z0 - 1], // Nord
    [90, m.x0 - 1, mz], // West
  ]
  const rotation = (sides.find(([, x, z]) => !set.has(key(x, z))) ?? sides[0])[0]
  // in Bauwerk-Koordinaten: Welt relativ zur Mitte des Hauptbaus, zurückgedreht
  const back = ((360 - rotation) % 360) as Rotation
  const local = rects.map(r => {
    const a = rot(r.x0 - mx, r.z0 - mz, back), b = rot(r.x0 + r.w - 1 - mx, r.z0 + r.d - 1 - mz, back)
    return { x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]) + 1, d: Math.abs(b[1] - a[1]) + 1 }
  })
  // Hauptbau bei 0,0; sein Anker (Mitte) liegt dann bei w>>1, d>>1 und muss in der Welt auf der Mitte landen
  const sx = local[0].x0, sz = local[0].z0
  const footprint = local.map(r => ({ ...r, x0: r.x0 - sx, z0: r.z0 - sz }))
  const [ax, az] = rot(sx + (footprint[0].w >> 1), sz + (footprint[0].d >> 1), rotation)
  return { footprint, rotation, pos: [mx + ax, y, mz + az], leftover }
}
