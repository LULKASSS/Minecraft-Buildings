// Ein Zustand S für die ganze App. Änderungen über update(), danach zeichnen sich die Bereiche neu.
// Ablauf: Bereich auf der Karte aufziehen → Bereich in 3D laden und durchfliegen → dort Bauwerke platzieren.

import type { Vec3 } from '../blueprint/blueprint'
import { boundsOf, layersOf, overlaps, place, type Bounds, type Layer, type Placed, type Placement } from '../blueprint/placement'
import type { Rotation } from '../blueprint/transform'
import { buildFromSource, type Category } from '../catalog'
import type { Size } from '../catalog/styles'
import type { Mix, Species } from '../catalog/nature'
import { setCustomPalettes, type Palette } from '../style/palettes'
import type { BlueprintSource } from '../blueprint/blueprint'
import type { WorldSession } from './world-session'
import * as store from './store'

/** Rechteckiger Bereich der Welt, Ecken einschließlich. */
export interface Area {
  id: string
  name: string
  x0: number
  z0: number
  x1: number
  z1: number
}

export const MAX_AREA = 512

export interface Project {
  worldKey: string
  worldName: string
  dataVersion: number
  areas: Area[]
  placements: Placement[]
  /** gelernte Paletten */
  palettes?: Palette[]
  updatedAt: number
}

/** Was im Bauen-Feld gerade gewählt ist. */
export interface BuildChoice {
  cat: Category
  type: string
  style: string
  palette: string
  size: Size
  species: Species
  mix: Mix
  templateId: string | null
  facade: boolean
  seeds: number[]
  pick: number
}

export type Selection = { kind: 'area' | 'placement'; id: string } | null

export interface State {
  theme: 'system' | 'light' | 'dark'
  view: 'map' | '3d'
  session: WorldSession | null
  busy: string | null
  project: Project
  sel: Selection
  /** Bereich, der gerade in 3D offen ist */
  openArea: string | null
  /** Bauwerk-Typ, der gerade in 3D an den Mauszeiger gehängt ist */
  placing: string | null
  build: BuildChoice
  guide: { layer: number | null; single: boolean; playing: boolean; tab: 'layer' | 'all' }
  savedFolder: string | null
  textures: 'none' | 'loading' | 'ready'
}

export const DEMO_DATA_VERSION = 4786 // 26.1

export function newSeeds(): number[] {
  return [0, 1, 2].map(() => Math.floor(Math.random() * 1e6))
}

/** Name für ein neues Bauwerk aus der Auswahl, z. B. "Haus" oder "Kirsche". */
export function placementLabel(b: BuildChoice = S.build): string {
  if (b.cat === 'natur') return b.type === 'baum' ? SPECIES_LABEL[b.species] : b.type === 'pinsel' ? MIX_LABEL[b.mix] : b.type === 'busch' ? 'Busch' : 'Fels'
  if (b.cat === 'vorlage') return 'Vorlage'
  return ({ haus: 'Haus', turm: 'Turm', brunnen: 'Brunnen', marktstand: 'Marktstand', laterne: 'Laterne' } as Record<string, string>)[b.type] ?? b.type
}
const SPECIES_LABEL: Record<Species, string> = { oak: 'Eiche', birch: 'Birke', spruce: 'Fichte', cherry: 'Kirsche', dark_oak: 'Dunkeleiche', acacia: 'Akazie' }
const MIX_LABEL: Record<Mix, string> = { wald: 'Laubwald', nadelwald: 'Nadelwald', kirschhain: 'Kirschhain', wiese: 'Blumenwiese', savanne: 'Savanne', felsen: 'Felsen' }

/** Quelle für das, was im Bauen-Feld gewählt ist (Variante = Seed). */
export function choiceSource(b: BuildChoice = S.build, seed = b.seeds[b.pick]): BlueprintSource {
  const params: Record<string, unknown> =
    b.cat === 'natur' ? { size: b.size, species: b.species, mix: b.mix }
    : b.cat === 'vorlage' ? { templateId: b.templateId, ...(b.facade ? { facade: { palette: b.palette, sides: [true, true, true, true], roof: false } } : {}) }
    : { style: b.style, palette: b.palette, size: b.size }
  return { generator: b.type, version: 1, seed, params }
}

function emptyProject(worldKey = '', worldName = '', dataVersion = DEMO_DATA_VERSION): Project {
  return { worldKey, worldName, dataVersion, areas: [], placements: [], updatedAt: Date.now() }
}

export const S: State = {
  theme: 'system',
  view: 'map',
  session: null,
  busy: null,
  project: emptyProject(),
  sel: null,
  openArea: null,
  placing: null,
  build: { cat: 'gebaeude', type: 'haus', style: 'mittelalter', palette: 'mittel-eiche', size: 'M', species: 'oak', mix: 'wald', templateId: null, facade: false, seeds: newSeeds(), pick: 0 },
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
  const p = await store.get<Project & { markers?: unknown }>('kv', `project:${worldKey}`)
  S.project = p ? { ...p, areas: p.areas ?? [], worldName, dataVersion } : emptyProject(worldKey, worldName, dataVersion)
  setCustomPalettes(S.project.palettes ?? [])
  // Bauwerke aus Fassung 1/2 hingen an Punkten statt an Bereichen: ohne Bereich nicht mehr erreichbar
  S.project.placements = S.project.placements.filter(pl => pl.areaId && S.project.areas.some(a => a.id === pl.areaId))
  S.sel = null
  S.openArea = null
  S.placing = null
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

export function selectedArea(): Area | null {
  if (S.sel?.kind !== 'area') return null
  return S.project.areas.find(a => a.id === S.sel!.id) ?? null
}

export function openArea(): Area | null {
  return S.project.areas.find(a => a.id === S.openArea) ?? null
}

export function placementsIn(areaId: string): Placement[] {
  return S.project.placements.filter(p => p.areaId === areaId)
}

// ---------- Aktionen ----------

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Rechteck aus zwei Ecken, auf höchstens MAX_AREA × MAX_AREA begrenzt. */
export function normalizeRect(ax: number, az: number, bx: number, bz: number): { x0: number; z0: number; x1: number; z1: number; clipped: boolean } {
  let x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz)
  let clipped = false
  if (x1 - x0 + 1 > MAX_AREA) { x1 = x0 + MAX_AREA - 1; clipped = true }
  if (z1 - z0 + 1 > MAX_AREA) { z1 = z0 + MAX_AREA - 1; clipped = true }
  return { x0, z0, x1, z1, clipped }
}

export function addArea(r: { x0: number; z0: number; x1: number; z1: number }): Area {
  const n = S.project.areas.length + 1
  const a: Area = { id: uid('a'), name: `Bereich ${n}`, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 }
  S.project.areas.push(a)
  S.sel = { kind: 'area', id: a.id }
  saveProject()
  update()
  return a
}

export function renameArea(id: string, name: string): void {
  const a = S.project.areas.find(a => a.id === id)
  if (!a) return
  a.name = name.trim() || a.name
  saveProject()
  update()
}

export function deleteArea(id: string): void {
  S.project.areas = S.project.areas.filter(a => a.id !== id)
  for (const p of placementsIn(id)) placedCache.delete(p.id)
  S.project.placements = S.project.placements.filter(p => p.areaId !== id)
  if (S.sel?.id === id) S.sel = null
  if (S.openArea === id) {
    S.openArea = null
    S.view = 'map'
  }
  saveProject()
  update()
}

export function addPlacement(areaId: string, source: BlueprintSource, label: string, pos: Vec3, rotation: Rotation): Placement {
  const n = placementsIn(areaId).filter(p => p.name.startsWith(label)).length + 1
  const p: Placement = {
    id: uid('p'),
    name: n === 1 ? label : `${label} ${n}`,
    areaId,
    source: JSON.parse(JSON.stringify(source)),
    pos,
    rotation,
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
  })
}

export function addPalette(p: Palette): void {
  S.project.palettes = [...(S.project.palettes ?? []), p]
  setCustomPalettes(S.project.palettes)
  saveProject()
  update()
}

export function renamePlacement(id: string, name: string): void {
  changePlacement(id, p => {
    p.name = name.trim() || p.name
  })
}

export function deletePlacement(id: string): void {
  const p = S.project.placements.find(p => p.id === id)
  S.project.placements = S.project.placements.filter(p => p.id !== id)
  placedCache.delete(id)
  if (S.sel?.id === id) S.sel = p?.areaId ? { kind: 'area', id: p.areaId } : null
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
