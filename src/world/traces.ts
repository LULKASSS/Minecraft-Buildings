// Spuren in der Welt: wo ihr lange wart (InhabitedTime je Chunk) und wo oben gebaute Blöcke liegen.
// Daraus die Orte, an denen ihr am meisten gemacht habt.

export interface TileStats {
  rx: number
  rz: number
  /** je Chunk (lx + lz*32): Sekunden */
  inhabited: Float32Array
  /** je Chunk: Spalten mit gebautem obersten Block */
  built: Uint16Array
}

export interface Hotspot {
  x: number
  z: number
  /** Stunden im meistbesuchten Chunk dort (die Zeit zählt in allen Chunks um den Spieler gleichzeitig, deshalb kein Summieren) */
  hours: number
  /** gebaute Spalten im Umkreis */
  built: number
}

const SPACING = 12 // Chunks Abstand zwischen zwei Orten (192 Blöcke)
const NEAR = 6 // Umkreis in Chunks, in dem gebaute Spalten zum Ort zählen

export function findHotspots(tiles: TileStats[], n = 6): Hotspot[] {
  const cells: { cx: number; cz: number; hours: number; built: number; score: number }[] = []
  const builtAt = new Map<string, number>()
  for (const t of tiles)
    for (let i = 0; i < 1024; i++) {
      const hours = t.inhabited[i] / 3600, built = t.built[i]
      if (hours < 0.05 && built < 4) continue
      const cx = t.rx * 32 + (i & 31), cz = t.rz * 32 + (i >> 5)
      if (built) builtAt.set(`${cx},${cz}`, built)
      // Zeit zählt stärker als gebaute Blöcke, sonst gewinnen unbetretene Dörfer
      cells.push({ cx, cz, hours, built, score: hours + Math.min(built, 256) / 128 })
    }
  cells.sort((a, b) => b.score - a.score)
  const out: Hotspot[] = []
  const peaks: { cx: number; cz: number }[] = []
  for (const c of cells) {
    if (out.length >= n) break
    if (c.hours < 0.25 && c.built < 24) break
    if (peaks.some(p => Math.abs(p.cx - c.cx) < SPACING && Math.abs(p.cz - c.cz) < SPACING)) continue
    peaks.push(c)
    // Mitte: Schwerpunkt der gebauten Spalten im Umkreis, sonst der Chunk selbst
    let sum = 0, sx = 0, sz = 0
    for (let dz = -NEAR; dz <= NEAR; dz++)
      for (let dx = -NEAR; dx <= NEAR; dx++) {
        const b = builtAt.get(`${c.cx + dx},${c.cz + dz}`)
        if (!b) continue
        sum += b
        sx += (c.cx + dx) * b
        sz += (c.cz + dz) * b
      }
    const mx = sum ? sx / sum : c.cx, mz = sum ? sz / sum : c.cz
    out.push({ x: Math.round(mx * 16 + 8), z: Math.round(mz * 16 + 8), hours: c.hours, built: sum })
  }
  return out
}
