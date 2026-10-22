// Bauplan von oben: eine Ebene als Kästchenraster, Norden oben. Jedes Kästchen zeigt die Oberseite des Blocks
// (Textur aus der .jar, sonst Farbe); Treppen, Stufen, Zäune usw. als Grundriss ihrer Form, höhere Teile heller.

import { parseState, shortName, type BlockState } from '../blueprint/blockstate'
import type { Layer, WorldBlock } from '../blueprint/placement'
import { shapeOf } from '../render/shapes'
import type { TexturedMesher } from '../render/textured'

export interface PlanBox {
  x0: number
  z0: number
  x1: number
  z1: number
}

export interface PlanLook {
  textured: TexturedMesher | null
  color(state: BlockState): [number, number, number]
}

/** Lage des Rasters im Canvas (CSS-Pixel), für die Maus. */
export interface PlanGrid {
  box: PlanBox
  cell: number
  left: number
  top: number
  blocks: Map<string, WorldBlock>
}

const LEFT = 34
const TOP = 20
const MAX_CELL = 28

/** Blöcke, die im Plan stehen: die Ebene selbst, bei „Alles“ der oberste Block je Spalte. */
export function planBlocks(layers: Layer[], index: number | null): WorldBlock[] {
  if (index !== null) return layers[index]?.blocks ?? []
  const top = new Map<string, WorldBlock>()
  for (const l of layers) for (const b of l.blocks) top.set(`${b.x},${b.z}`, b)
  return [...top.values()]
}

export function drawPlan(canvas: HTMLCanvasElement, layers: Layer[], index: number | null, box: PlanBox, look: PlanLook, width: number, maxHeight: number): PlanGrid {
  const w = box.x1 - box.x0 + 1, d = box.z1 - box.z0 + 1
  const cell = Math.max(5, Math.min(MAX_CELL, Math.floor((width - LEFT - 6) / w), Math.floor((maxHeight - TOP - 6) / d)))
  const cssW = LEFT + w * cell + 6, cssH = TOP + d * cell + 6
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  const css = getComputedStyle(document.documentElement)
  const tok = (n: string, f: string) => css.getPropertyValue(n).trim() || f
  const bg = tok('--surface-2', '#f3f3f6'), line = tok('--line', 'rgba(0,0,0,.08)'), fg3 = tok('--fg-3', '#888'), accent = tok('--accent', '#7f5fe8')

  ctx.fillStyle = bg
  ctx.fillRect(LEFT, TOP, w * cell, d * cell)

  const px = (x: number) => LEFT + (x - box.x0) * cell
  const pz = (z: number) => TOP + (z - box.z0) * cell
  const cur = planBlocks(layers, index)
  const at = new Map(cur.map(b => [`${b.x},${b.z}`, b]))
  // Ebene darunter blass, damit man sieht, worauf man baut
  if (index !== null && index > 0) {
    ctx.globalAlpha = 0.22
    for (const b of layers[index - 1].blocks) if (!at.has(`${b.x},${b.z}`)) drawBlock(ctx, b.state, px(b.x), pz(b.z), cell, look)
    ctx.globalAlpha = 1
  }
  for (const b of cur) drawBlock(ctx, b.state, px(b.x), pz(b.z), cell, look)

  // Raster
  ctx.strokeStyle = line
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= w; i++) {
    ctx.moveTo(LEFT + i * cell + 0.5, TOP)
    ctx.lineTo(LEFT + i * cell + 0.5, TOP + d * cell)
  }
  for (let k = 0; k <= d; k++) {
    ctx.moveTo(LEFT, TOP + k * cell + 0.5)
    ctx.lineTo(LEFT + w * cell, TOP + k * cell + 0.5)
  }
  ctx.stroke()
  // alle 5 Blöcke eine kräftigere Linie: zum Abzählen im Spiel
  ctx.strokeStyle = fg3
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  for (let i = 0; i <= w; i++) if ((box.x0 + i) % 5 === 0) { ctx.moveTo(LEFT + i * cell + 0.5, TOP); ctx.lineTo(LEFT + i * cell + 0.5, TOP + d * cell) }
  for (let k = 0; k <= d; k++) if ((box.z0 + k) % 5 === 0) { ctx.moveTo(LEFT, TOP + k * cell + 0.5); ctx.lineTo(LEFT + w * cell, TOP + k * cell + 0.5) }
  ctx.stroke()
  ctx.globalAlpha = 1

  // Koordinaten am Rand: X oben, Z links, an jeder Fünferlinie und am Anfang
  ctx.fillStyle = fg3
  ctx.font = '500 10px Geist, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  // Anfang nur beschriften, wenn die nächste Fünferlinie nicht zu nah ist (sonst überlappen die Zahlen)
  const room = Math.ceil(22 / cell)
  const firstX = ((5 - (((box.x0 % 5) + 5) % 5)) % 5)
  for (let i = 0; i < w; i++) {
    const x = box.x0 + i
    if ((i === 0 && (firstX === 0 || firstX >= room)) || x % 5 === 0) ctx.fillText(String(x), LEFT + i * cell + cell / 2, TOP / 2)
  }
  ctx.textAlign = 'right'
  const firstZ = ((5 - (((box.z0 % 5) + 5) % 5)) % 5)
  const roomZ = Math.ceil(12 / cell)
  for (let k = 0; k < d; k++) {
    const z = box.z0 + k
    if ((k === 0 && (firstZ === 0 || firstZ >= roomZ)) || z % 5 === 0) ctx.fillText(String(z), LEFT - 5, TOP + k * cell + cell / 2)
  }
  // Norden
  ctx.textAlign = 'left'
  ctx.fillStyle = accent
  ctx.font = '600 10px Geist, system-ui, sans-serif'
  ctx.fillText('N ↑', 2, TOP / 2)
  return { box, cell, left: LEFT, top: TOP, blocks: at }
}

/** Ein Block von oben: volle Blöcke als Bild, andere als Grundriss ihrer Teile; tiefere Teile dunkler. */
function drawBlock(ctx: CanvasRenderingContext2D, state: BlockState, x: number, y: number, cell: number, look: PlanLook): void {
  const icon = look.textured?.icon(state) ?? null
  const [r, g, b] = look.color(state)
  const boxes = [...shapeOf(state)].sort((p, q) => p[4] - q[4])
  const full = boxes.length === 1 && boxes[0][0] === 0 && boxes[0][2] === 0 && boxes[0][3] === 1 && boxes[0][5] === 1
  for (const [x0, , z0, x1, y1, z1] of boxes) {
    const dx = x + x0 * cell, dz = y + z0 * cell, dw = Math.max(1, (x1 - x0) * cell), dh = Math.max(1, (z1 - z0) * cell)
    if (icon) ctx.drawImage(icon, x0 * 16, z0 * 16, Math.max(1, (x1 - x0) * 16), Math.max(1, (z1 - z0) * 16), dx, dz, dw, dh)
    else {
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(dx, dz, dw, dh)
    }
    if (y1 < 0.99) {
      ctx.fillStyle = `rgba(0,0,0,${0.42 * (1 - y1)})`
      ctx.fillRect(dx, dz, dw, dh)
    }
  }
  if (!full && cell >= 10) {
    ctx.strokeStyle = 'rgba(0,0,0,.35)'
    ctx.lineWidth = 1
    for (const [x0, , z0, x1, , z1] of boxes) ctx.strokeRect(x + x0 * cell + 0.5, y + z0 * cell + 0.5, Math.max(1, (x1 - x0) * cell - 1), Math.max(1, (z1 - z0) * cell - 1))
  }
  // Treppen: Pfeil in Laufrichtung nach oben (zur hohen Seite)
  const { name, props } = parseState(state)
  if (shortName(name).endsWith('_stairs') && cell >= 9) arrow(ctx, x + cell / 2, y + cell / 2, cell * 0.3, props.facing)
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, facing: string | undefined): void {
  const a = { north: -Math.PI / 2, south: Math.PI / 2, east: 0, west: Math.PI }[facing ?? 'north'] ?? 0
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(a)
  ctx.beginPath()
  ctx.moveTo(s, 0)
  ctx.lineTo(-s * 0.6, -s * 0.75)
  ctx.lineTo(-s * 0.6, s * 0.75)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,.92)'
  ctx.strokeStyle = 'rgba(0,0,0,.6)'
  ctx.lineWidth = 1
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Kästchen unter der Maus (Weltkoordinaten x, z) oder null. */
export function cellAt(g: PlanGrid, mx: number, my: number): { x: number; z: number } | null {
  const i = Math.floor((mx - g.left) / g.cell), k = Math.floor((my - g.top) / g.cell)
  if (i < 0 || k < 0 || i > g.box.x1 - g.box.x0 || k > g.box.z1 - g.box.z0) return null
  return { x: g.box.x0 + i, z: g.box.z0 + k }
}

const DIR: Record<string, string> = { north: 'Norden', south: 'Süden', east: 'Osten', west: 'Westen', up: 'oben', down: 'unten' }

/** Kurzbeschreibung des Zustands für den Tooltip: „nach Norden, untere Hälfte“. */
export function stateHint(state: BlockState): string {
  const { name, props } = parseState(state)
  const id = shortName(name)
  const out: string[] = []
  if (props.facing) out.push(id.endsWith('_stairs') ? `steigt nach ${DIR[props.facing]}` : `zeigt nach ${DIR[props.facing] ?? props.facing}`)
  if (id.endsWith('_slab') && props.type !== 'double') out.push(props.type === 'top' ? 'obere Hälfte' : 'untere Hälfte')
  if (id.endsWith('_stairs') && props.half === 'top') out.push('kopfüber')
  if (props.axis && props.axis !== 'y') out.push(props.axis === 'x' ? 'liegt Ost–West' : 'liegt Nord–Süd')
  if (props.hanging === 'true') out.push('hängend')
  if (id.endsWith('_door') && props.half) out.push(props.half === 'upper' ? 'obere Hälfte' : 'untere Hälfte')
  return out.join(', ')
}
