// Ein Zustand S für die ganze App. Änderungen über update(), danach zeichnen sich die Bereiche neu.

import type { Vec3 } from '../blueprint/blueprint'
import { boundsOf, layersOf, overlaps, place, type Bounds, type Layer, type Placed, type Placement } from '../blueprint/placement'
import type { Rotation } from '../blueprint/transform'
import { buildFromSource } from '../catalog'
import type { WorldSession } from './world-session'
import * as store from './store'

export interface Marker {
  id: string
  name: string
  kind: 'point' | 'line' | 'area'
  points: [number, number][]
  y: number
}

export interface Project {
  worldKey: string
  worldName: string
  dataVersion: number
  markers: Marker[]
  placements: Placement[]
  updatedAt: number
}

export type Selection = { kind: 'marker' | 'placement'; id: string } | null

export interface State {
  theme: 'system' | 'light' | 'dark'
  view: 'map' | '3d'
  session: WorldSession | null
  busy: string | null
  project: Project
  sel: Selection
  guide: { layer: number | null; single: boolean; playing: boolean; tab: 'layer' | 'all' }
  savedFolder: string | null
  textures: 'none' | 'loading' | 'ready'
}

export const DEMO_DATA_VERSION = 4786 // 26.1

function emptyProject(worldKey = '', worldName = '', dataVersion = DEMO_DATA_VERSION): Project {
  return { worldKey, worldName, dataVersion, markers: [], placements: [], updatedAt: Date.now() }
}

export const S: State = {
  theme: 'system',
  view: 'map',
  session: null,
  busy: null,
  project: emptyProject(),
  sel: null,
  guide: { layer: null, single: false, playing: false, tab: 'layer' },
  savedFolder: null,
  textures: 'none',
}

type Listener = (s: State) => void
const listeners: Listener[] = []
let scheduled = false

export function subscribe(fn: Listener): void {
  listeners.push(fn)
}

export function update(fn?: (s: State) => void): void {
  fn?.(S)
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    for (const l of listeners) l(S)
  })
}

// ---------- Projekt speichern ----------

let saveTimer: number | undefined

export function saveProject(): void {
  S.project.updatedAt = Date.now()
  if (!S.project.worldKey) return
  clearTimeout(saveTimer)
  const snapshot = JSON.parse(JSON.stringify(S.project)) as Project
  saveTimer = window.setTimeout(() => store.put('kv', `project:${snapshot.worldKey}`, snapshot), 250)
}

export async function loadProject(worldKey: string, worldName: string, dataVersion: number): Promise<void> {
  const p = await store.get<Project>('kv', `project:${worldKey}`)
  S.project = p ? { ...p, worldName, dataVersion } : emptyProject(worldKey, worldName, dataVersion)
  S.sel = null
  placedCache.clear()
}

// ---------- Abgeleitet: platzierte Bauwerke ----------

const placedCache = new Map<string, { key: string; placed: Placed; layers: Layer[] }>()

function keyOf(p: Placement): string {
  return JSON.stringify([p.source, p.pos, p.rotation, p.mirror])
}

export function placedOf(p: Placement): { placed: Placed; layers: Layer[] } {
  const key = keyOf(p)
  const hit = placedCache.get(p.id)
  if (hit && hit.key === key) return hit
  const placed = place(p, buildFromSource(p.source))
  const entry = { key, placed, layers: layersOf(placed) }
  placedCache.set(p.id, entry)
  return entry
}

export function allBounds(): { p: Placement; b: Bounds }[] {
  return S.project.placements.map(p => ({ p, b: boundsOf(placedOf(p).placed) }))
}

/** Welche Platzierungen überschneiden sich mit anderen? */
export function collisions(): Set<string> {
  const all = allBounds()
  const out = new Set<string>()
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (overlaps(all[i].b, all[j].b)) {
        out.add(all[i].p.id)
        out.add(all[j].p.id)
      }
  return out
}

export function selectedPlacement(): Placement | null {
  if (S.sel?.kind !== 'placement') return null
  return S.project.placements.find(p => p.id === S.sel!.id) ?? null
}

export function selectedMarker(): Marker | null {
  if (S.sel?.kind !== 'marker') return null
  return S.project.markers.find(m => m.id === S.sel!.id) ?? null
}

// ---------- Aktionen ----------

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function addMarker(x: number, z: number, y: number): Marker {
  const n = S.project.markers.length + 1
  const m: Marker = { id: uid('m'), name: `Punkt ${n}`, kind: 'point', points: [[x, z]], y }
  S.project.markers.push(m)
  S.sel = { kind: 'marker', id: m.id }
  saveProject()
  update()
  return m
}

export function moveMarker(id: string, x: number, z: number, y: number): void {
  const m = S.project.markers.find(m => m.id === id)
  if (!m) return
  m.points = [[x, z]]
  m.y = y
  // Bauwerke an dieser Markierung wandern mit
  for (const p of S.project.placements) if (p.markerId === id) p.pos = [x, y, z]
  saveProject()
  update()
}

export function renameMarker(id: string, name: string): void {
  const m = S.project.markers.find(m => m.id === id)
  if (!m) return
  m.name = name.trim() || m.name
  for (const p of S.project.placements) if (p.markerId === id) p.name = m.name
  saveProject()
  update()
}

export function deleteMarker(id: string): void {
  S.project.markers = S.project.markers.filter(m => m.id !== id)
  for (const p of S.project.placements) if (p.markerId === id) delete p.markerId
  if (S.sel?.id === id) S.sel = null
  saveProject()
  update()
}

export function placeAtMarker(markerId: string, generator: string): Placement {
  const m = S.project.markers.find(m => m.id === markerId)!
  const [x, z] = m.points[0]
  const p: Placement = {
    id: uid('p'),
    name: m.name,
    markerId,
    source: { generator, version: 1, seed: 0, params: {} },
    pos: [x, m.y, z],
    rotation: 0,
    mirror: false,
  }
  S.project.placements.push(p)
  S.sel = { kind: 'placement', id: p.id }
  S.guide.layer = null
  saveProject()
  update()
  return p
}

export function changePlacement(id: string, fn: (p: Placement) => void): void {
  const p = S.project.placements.find(p => p.id === id)
  if (!p) return
  fn(p)
  saveProject()
  update()
}

export function rotatePlacement(id: string, dir: 1 | -1): void {
  changePlacement(id, p => {
    p.rotation = (((p.rotation + dir * 90) % 360 + 360) % 360) as Rotation
  })
}

export function nudgePlacement(id: string, d: Vec3): void {
  changePlacement(id, p => {
    p.pos = [p.pos[0] + d[0], p.pos[1] + d[1], p.pos[2] + d[2]]
    if (d[0] || d[2]) delete p.markerId // vom Punkt gelöst, sobald seitlich verschoben
  })
}

export function deletePlacement(id: string): void {
  S.project.placements = S.project.placements.filter(p => p.id !== id)
  placedCache.delete(id)
  if (S.sel?.id === id) S.sel = null
  saveProject()
  update()
}

// ---------- Hinweise ----------

let toastTimer: number | undefined
export function toast(text: string, bad = false): void {
  const el = document.getElementById('toast')!
  el.textContent = text
  el.classList.toggle('bad', bad)
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (el.hidden = true), bad ? 6000 : 3200)
}
