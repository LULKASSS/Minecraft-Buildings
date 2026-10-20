// Drehen und Spiegeln von Bauwerken samt Blockstates.
// Drehung im Uhrzeigersinn von oben gesehen (wie Rotation.CLOCKWISE_90 im Spiel),
// Spiegeln vertauscht Ost und West (x wird umgedreht). Erst spiegeln, dann drehen.

import { formatState, parseState, type BlockState, type Props } from './blockstate'
import { Blueprint, type Vec3 } from './blueprint'

export type Rotation = 0 | 90 | 180 | 270

const H = ['north', 'east', 'south', 'west'] as const
type Dir = (typeof H)[number]

function isDir(v: string): v is Dir {
  return (H as readonly string[]).includes(v)
}

function rotDir(d: string, steps: number): string {
  if (!isDir(d)) return d
  return H[(H.indexOf(d) + steps) % 4]
}

function mirDir(d: string): string {
  return d === 'east' ? 'west' : d === 'west' ? 'east' : d
}

function swapLR(v: string): string {
  if (v.endsWith('_left')) return v.slice(0, -5) + '_right'
  if (v.endsWith('_right')) return v.slice(0, -6) + '_left'
  if (v === 'left') return 'right'
  if (v === 'right') return 'left'
  return v
}

const RAIL_PAIRS = ['north_south', 'east_west', 'north_east', 'north_west', 'south_east', 'south_west']

function railShape(v: string, f: (d: string) => string): string {
  if (v.startsWith('ascending_')) return 'ascending_' + f(v.slice(10))
  const [a, b] = v.split('_').map(f)
  const direct = `${a}_${b}`
  return RAIL_PAIRS.includes(direct) ? direct : `${b}_${a}`
}

function transformProps(name: string, props: Props, mirror: boolean, steps: number): Props {
  const dir = (d: string) => rotDir(mirror ? mirDir(d) : d, steps)
  const out: Props = {}
  for (const [k, v] of Object.entries(props)) {
    if (isDir(k)) {
      out[dir(k)] = v
      continue
    }
    switch (k) {
      case 'facing':
        out[k] = dir(v)
        break
      case 'axis':
        out[k] = steps % 2 === 1 && (v === 'x' || v === 'z') ? (v === 'x' ? 'z' : 'x') : v
        break
      case 'rotation': {
        let r = Number(v)
        if (mirror) r = (16 - r) % 16
        out[k] = String((r + steps * 4) % 16)
        break
      }
      case 'shape':
        if (name.endsWith('rail')) out[k] = railShape(v, dir)
        else out[k] = mirror ? swapLR(v) : v
        break
      case 'hinge':
        out[k] = mirror ? swapLR(v) : v
        break
      case 'type':
        // Truhen: left/right; Stufen: top/bottom/double bleiben.
        out[k] = mirror && (v === 'left' || v === 'right') ? swapLR(v) : v
        break
      case 'orientation':
        out[k] = v.split('_').map(dir).join('_')
        break
      default:
        out[k] = v
    }
  }
  return out
}

export function transformState(state: BlockState, rotation: Rotation, mirror = false): BlockState {
  const steps = rotation / 90
  if (steps === 0 && !mirror) return state
  const { name, props } = parseState(state)
  return formatState(name, transformProps(name, props, mirror, steps))
}

/** Lage eines Punkts im gedrehten Bauwerk. */
export function transformPos(p: Vec3, size: Vec3, rotation: Rotation, mirror = false): Vec3 {
  let [x, y, z] = p
  let [w, , d] = size
  if (mirror) x = w - 1 - x
  for (let s = 0; s < rotation / 90; s++) {
    ;[x, z] = [d - 1 - z, x]
    ;[w, d] = [d, w]
  }
  return [x, y, z]
}

export function transformedSize(size: Vec3, rotation: Rotation): Vec3 {
  return rotation === 90 || rotation === 270 ? [size[2], size[1], size[0]] : [...size]
}

export function transformBlueprint(bp: Blueprint, rotation: Rotation, mirror = false): Blueprint {
  if (rotation === 0 && !mirror) return bp
  const out = new Blueprint({
    size: transformedSize(bp.size, rotation),
    name: bp.name,
    kind: bp.kind,
    source: bp.source,
    anchor: transformPos(bp.anchor, bp.size, rotation, mirror),
  })
  const cache = new Map<number, number>()
  const [w, h, d] = bp.size
  for (let y = 0; y < h; y++)
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const p = bp.blocks[bp.index(x, y, z)]
        if (p === 0) continue
        let q = cache.get(p)
        if (q === undefined) {
          q = out.paletteIndex(transformState(bp.palette[p], rotation, mirror))
          cache.set(p, q)
        }
        const [tx, ty, tz] = transformPos([x, y, z], bp.size, rotation, mirror)
        out.blocks[out.index(tx, ty, tz)] = q
      }
  return out
}
