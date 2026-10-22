// Ein Zustand S für die ganze App. Änderungen über update(), danach zeichnet sich die Oberfläche neu.
// Ablauf: Welt laden → sofort 3D → umsehen oder fliegen → Bauwerk setzen → anklicken = Anleitung.

import type { Vec3 } from '../blueprint/blueprint'
import { boundsOf, layersOf, overlaps, place, type Bounds, type Layer, type Placed, type Placement } from '../blueprint/placement'
import type { Rotation } from '../blueprint/transform'
import { buildFromSource, entryOf, type Category } from '../catalog'
import type { Size } from '../catalog/styles'
import type { Mix, Species } from '../catalog/nature'
import { setCustomPalettes, type Palette } from '../style/palettes'
import type { BlueprintSource } from '../blueprint/blueprint'
import type { WorldSession } from './world-session'
import * as store from './store'

export interface Project {
  worldKey: string
  worldName: string
  dataVersion: number
  placements: Placement[]
  /** wo die Kamera zuletzt hinsah (Drehpunkt) und aus welchem Abstand */
  camera?: { x: number; y: number; z: number; dist: number }
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
  /** Bauform (Haus, Brunnen, Brücke); 'alle' = jede Variante eine andere */
  form: string
  /** bei 'alle': mit welcher Form die erste Variante beginnt (wechselt beim Würfeln) */
  formOffset: number
  seeds: number[]
  pick: number
  /** Brücke: Breite in Blöcken und Deko (0 wenig, 1 normal, 2 viel) */
  width: number
  deco: number
  /** Haus: Dachform ('alle' = der Seed entscheidet) */
  roofShape: string
  /** Reiter „Entwürfe“: gewählter gemerkter Entwurf */
  draft: { name: string; source: BlueprintSource } | null
}

export type Selection = { kind: 'placement'; id: string } | null

export interface State {
  theme: 'system' | 'light' | 'dark'
  /** große Karte über der 3D-Ansicht (zum Hinspringen) */
  bigMap: boolean
  /** Kamera: umsehen oder Flugmodus */
  camMode: 'orbit' | 'fly'
  session: WorldSession | null
  busy: string | null
  project: Project
  sel: Selection
  /** Bauwerk-Typ, der gerade in 3D an den Mauszeiger gehängt ist */
  placing: string | null
  /** Höhe beim Setzen: dy über/unter dem anvisierten Block, oder fest gehaltenes Y */
  placeAdjust: { dy: number; lockY: number | null }
  /** Brücke setzen: bisher geklickte Punkte (Welt) */
  path: Vec3[]
  build: BuildChoice
  guide: { layer: number | null; single: boolean; playing: boolean; tab: 'layer' | 'all' }
  savedFolder: string | null
  textures: 'none' | 'loading' | 'ready'
  /** Spuren auf der Karte: wo ihr wart und gebaut habt */
  traces: boolean
  /** woher die Texturen kommen, für die Anzeige */
  texturesFrom: string | null
  panelCollapsed: boolean
}

export const DEMO_DATA_VERSION = 4786 // 26.1

export const VARIANTS = 6

export function newSeeds(): number[] {
  return Array.from({ length: VARIANTS }, () => Math.floor(Math.random() * 1e6))
}

/** Bauform der Variante i: fest gewählt oder bei 'alle' reihum, damit jede Variante anders aussieht. */
export function formOf(b: BuildChoice, i: number): string | undefined {
  const forms = entryOf(b.type).formsFor?.(b.style).map(f => f.id)
  if (!forms?.length) return undefined
  if (b.form !== 'alle' && forms.includes(b.form)) return b.form
  return forms[(b.formOffset + i) % forms.length]
}

/** Name für ein neues Bauwerk aus der Auswahl, z. B. "Haus" oder "Kirsche". */
export function placementLabel(b: BuildChoice = S.build): string {
  if (b.cat === 'entwuerfe' && b.draft) return b.draft.name
  if (b.cat === 'natur') return b.type === 'baum' ? SPECIES_LABEL[b.species] : b.type === 'pinsel' ? MIX_LABEL[b.mix] : b.type === 'busch' ? 'Busch' : 'Fels'
  if (b.cat === 'vorlage') return 'Vorlage'
  return entryOf(b.type).label
}
const SPECIES_LABEL: Record<Species, string> = { oak: 'Eiche', birch: 'Birke', spruce: 'Fichte', cherry: 'Kirsche', dark_oak: 'Dunkeleiche', acacia: 'Akazie' }
const MIX_LABEL: Record<Mix, string> = { wald: 'Laubwald', nadelwald: 'Nadelwald', kirschhain: 'Kirschhain', wiese: 'Blumenwiese', savanne: 'Savanne', felsen: 'Felsen' }

/** Quelle für das, was im Bauen-Feld gewählt ist (Variante = Seed). */
export function choiceSource(b: BuildChoice = S.build, seed = b.seeds[b.pick], index = b.pick): BlueprintSource {
  if (b.cat === 'entwuerfe' && b.draft) return JSON.parse(JSON.stringify(b.draft.source)) as BlueprintSource
  const params: Record<string, unknown> =
    b.cat === 'natur' ? { size: b.size, species: b.species, mix: b.mix }
    : b.cat === 'vorlage' ? { templateId: b.templateId, ...(b.facade ? { facade: { palette: b.palette, sides: [true, true, true, true], roof: false } } : {}) }
    : { style: b.style, palette: b.palette, size: b.size, ...(formOf(b, index) ? { form: formOf(b, index) } : {}), ...(b.type === 'bruecke' ? { width: b.width, deco: b.deco } : {}), ...(b.type === 'haus' && b.roofShape !== 'alle' ? { roofShape: b.roofShape } : {}) }
  // Haus Version 3: Dachformen, Gauben, Balkon (Fassung 15); gesetzte Häuser mit Version 2 bleiben, wie sie sind
  return { generator: b.type, version: b.type === 'haus' ? 3 : 1, seed, params }
}

function emptyProject(worldKey = '', worldName = '', dataVersion = DEMO_DATA_VERSION): Project {
  return { worldKey, worldName, dataVersion, placements: [], updatedAt: Date.now() }
}

export const S: State = {
  theme: 'system',
  bigMap: false,
  camMode: 'orbit',
  session: null,
  busy: null,
  project: emptyProject(),
  sel: null,
  placing: null,
  placeAdjust: { dy: 0, lockY: null },
  path: [],
  build: { cat: 'gebaeude', type: 'haus', style: 'mittelalter', palette: 'mittel-putz', size: 'M', species: 'oak', mix: 'wald', templateId: null, facade: false, form: 'alle', formOffset: 0, seeds: newSeeds(), pick: 0, width: 5, deco: 1, roofShape: 'alle', draft: null },
  guide: { layer: null, single: false, playing: false, tab: 'layer' },
  savedFolder: null,
  textures: 'none',
  traces: true,
  texturesFrom: null,
  panelCollapsed: false,
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

/** Kamera merken, damit die Welt beim nächsten Öffnen dort weitergeht (ohne neu zu zeichnen). */
export function rememberCamera(c: { x: number; y: number; z: number; dist: number }): void {
  S.project.camera = { x: Math.round(c.x), y: Math.round(c.y), z: Math.round(c.z), dist: Math.round(c.dist) }
  saveProject()
}

export function saveProject(): void {
  S.project.updatedAt = Date.now()
  if (!S.project.worldKey) return
  clearTimeout(saveTimer)
  const snapshot = JSON.parse(JSON.stringify(S.project)) as Project
  saveTimer = window.setTimeout(() => store.put('kv', `project:${snapshot.worldKey}`, snapshot), 250)
}

export async function loadProject(worldKey: string, worldName: string, dataVersion: number): Promise<void> {
  const p = await store.get<Project & { areas?: unknown }>('kv', `project:${worldKey}`)
  if (p) delete p.areas // Bereiche gab es bis Fassung 5, die Bauwerke darin bleiben
  S.project = p ? { ...p, worldName, dataVersion } : emptyProject(worldKey, worldName, dataVersion)
  setCustomPalettes(S.project.palettes ?? [])
  S.sel = null
  S.placing = null
  S.bigMap = false
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

// ---------- Aktionen ----------

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function addPlacement(source: BlueprintSource, label: string, pos: Vec3, rotation: Rotation): Placement {
  const n = S.project.placements.filter(p => p.name.startsWith(label)).length + 1
  const p: Placement = {
    id: uid('p'),
    name: n === 1 ? label : `${label} ${n}`,
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
