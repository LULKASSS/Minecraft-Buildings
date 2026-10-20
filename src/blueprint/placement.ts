// Ein Bauwerk an einer Stelle der Welt: Lage, Drehung, Spiegelung.
// pos ist die Weltkoordinate, auf der der Ankerpunkt des Bauwerks landet.

import type { BlockState } from './blockstate'
import { Blueprint, type BlueprintSource, type Vec3 } from './blueprint'
import { materialsOf, type MaterialRow } from './materials'
import { transformBlueprint, type Rotation } from './transform'

export interface Placement {
  id: string
  name: string
  markerId?: string
  source: BlueprintSource
  pos: Vec3
  rotation: Rotation
  mirror: boolean
}

export interface Placed {
  placement: Placement
  blueprint: Blueprint // bereits gedreht/gespiegelt
  origin: Vec3 // Weltkoordinate der kleinsten Ecke
}

export function place(placement: Placement, base: Blueprint): Placed {
  const blueprint = transformBlueprint(base, placement.rotation, placement.mirror)
  const [px, py, pz] = placement.pos
  const [ax, ay, az] = blueprint.anchor
  return { placement, blueprint, origin: [px - ax, py - ay, pz - az] }
}

export interface Bounds {
  min: Vec3
  max: Vec3 // einschließlich
}

export function boundsOf(p: Placed): Bounds {
  const [w, h, d] = p.blueprint.size
  const [x, y, z] = p.origin
  return { min: [x, y, z], max: [x + w - 1, y + h - 1, z + d - 1] }
}

export function overlaps(a: Bounds, b: Bounds): boolean {
  return a.min[0] <= b.max[0] && b.min[0] <= a.max[0]
    && a.min[1] <= b.max[1] && b.min[1] <= a.max[1]
    && a.min[2] <= b.max[2] && b.min[2] <= a.max[2]
}

export interface WorldBlock {
  x: number
  y: number
  z: number
  state: BlockState
}

export interface Layer {
  /** Ebene im Bauwerk, 0 = unterste */
  index: number
  /** Weltkoordinate Y */
  y: number
  blocks: WorldBlock[]
  materials: MaterialRow[]
}

/** Bauanleitung: pro Y-Ebene die Blöcke in Weltkoordinaten, sortiert nach z, dann x. */
export function layersOf(p: Placed): Layer[] {
  const [, h] = p.blueprint.size
  const [ox, oy, oz] = p.origin
  const layers: Layer[] = []
  for (let i = 0; i < h; i++) layers.push({ index: i, y: oy + i, blocks: [], materials: [] })
  for (const b of p.blueprint.each()) {
    layers[b.y].blocks.push({ x: ox + b.x, y: oy + b.y, z: oz + b.z, state: b.state })
  }
  for (const l of layers) l.materials = materialsOf(l.blocks.map(b => b.state))
  return layers
}
