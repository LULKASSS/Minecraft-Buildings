// Alle Bauwerk-Typen. Jeder erzeugt aus seiner Quelle (Generator, Version, Seed, Parameter)
// immer dasselbe Bauwerk, deshalb speichert die App nur die Quelle.

import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { TEST_HOUSE_ID, testHouse } from './decorative/test-house'
import { buildHouse, houseGroundExtent } from './house'
import { buildBush, buildRock, buildScatter, buildTree, scatterExtent } from './nature'
import { buildLamp, buildStall, buildTower, buildWell, stallExtent, towerExtent, wellExtent } from './small'
import { buildTemplate, templateExtent } from './template'

export type Category = 'gebaeude' | 'natur' | 'vorlage'

export interface Extent {
  x0: number
  z0: number
  x1: number
  z1: number
}

export interface CatalogEntry {
  id: string
  label: string
  category: Category
  kind: 'decorative' | 'functional'
  /** braucht Stil und Palette */
  styled: boolean
  /** Varianten über den Seed */
  seeded: boolean
  /** Für welche Fläche der Generator Geländehöhen braucht (lokal, relativ zum Anker) */
  ground?: (source: BlueprintSource) => Extent | null
  build(source: BlueprintSource): Blueprint
  hidden?: boolean
}

export const CATALOG: CatalogEntry[] = [
  { id: 'haus', label: 'Haus', category: 'gebaeude', kind: 'decorative', styled: true, seeded: true, ground: houseGroundExtent, build: buildHouse },
  { id: 'turm', label: 'Turm', category: 'gebaeude', kind: 'decorative', styled: true, seeded: true, ground: towerExtent, build: buildTower },
  { id: 'brunnen', label: 'Brunnen', category: 'gebaeude', kind: 'decorative', styled: true, seeded: false, ground: wellExtent, build: buildWell },
  { id: 'marktstand', label: 'Marktstand', category: 'gebaeude', kind: 'decorative', styled: true, seeded: false, ground: stallExtent, build: buildStall },
  { id: 'laterne', label: 'Laterne', category: 'gebaeude', kind: 'decorative', styled: true, seeded: false, build: buildLamp },
  { id: 'baum', label: 'Baum', category: 'natur', kind: 'decorative', styled: false, seeded: true, build: buildTree },
  { id: 'busch', label: 'Busch', category: 'natur', kind: 'decorative', styled: false, seeded: true, build: buildBush },
  { id: 'fels', label: 'Fels', category: 'natur', kind: 'decorative', styled: false, seeded: true, build: buildRock },
  { id: 'pinsel', label: 'Natur-Pinsel', category: 'natur', kind: 'decorative', styled: false, seeded: true, ground: scatterExtent, build: buildScatter },
  { id: 'vorlage', label: 'Vorlage', category: 'vorlage', kind: 'functional', styled: false, seeded: false, ground: templateExtent, build: buildTemplate },
  { id: TEST_HOUSE_ID, label: 'Testhaus', category: 'gebaeude', kind: 'decorative', styled: false, seeded: false, build: () => testHouse(), hidden: true },
]

export function entryOf(generator: string): CatalogEntry {
  const e = CATALOG.find(e => e.id === generator)
  if (!e) throw new Error(`Unbekannter Bauwerk-Typ: ${generator}`)
  return e
}

export function buildFromSource(source: BlueprintSource): Blueprint {
  return entryOf(source.generator).build(source)
}
