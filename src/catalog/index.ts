// Alle Bauwerk-Typen. Jeder erzeugt aus seiner Quelle (Generator, Version, Seed, Parameter)
// immer dasselbe Bauwerk, deshalb speichert die App nur die Quelle.

import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { TEST_HOUSE_ID, testHouse } from './decorative/test-house'
import { buildHouse, houseGroundExtent } from './house'
import { buildBush, buildRock, buildScatter, buildTree, scatterExtent } from './nature'
import { buildLamp, buildStall, buildTower, buildWell, stallExtent, towerExtent, wellExtent, wellForms } from './small'
import { bridgeExtent, bridgeForms, buildBridge } from './bridge'
import { HOUSE_FORMS, styleById } from './styles'
import { buildTemplate, templateExtent } from './template'
import { DEKO } from './deko'

export type Category = 'gebaeude' | 'deko' | 'natur' | 'vorlage' | 'entwuerfe'

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
  /** S/M/L ändert etwas (Standard: ja) */
  sized?: boolean
  /** Bauformen je Stil (Haus, Brunnen, Brücke): Würfeln wechselt auch die Form */
  formsFor?: (style: string) => FormChoice[]
  /** Für welche Fläche der Generator Geländehöhen braucht (lokal, relativ zum Anker) */
  ground?: (source: BlueprintSource) => Extent | null
  build(source: BlueprintSource): Blueprint
  hidden?: boolean
}

export interface FormChoice {
  id: string
  label: string
}

const houseForms = (style: string): FormChoice[] => HOUSE_FORMS.filter(f => styleById(style).forms.includes(f.id))

export const CATALOG: CatalogEntry[] = [
  { id: 'haus', label: 'Haus', category: 'gebaeude', kind: 'decorative', styled: true, seeded: true, formsFor: houseForms, ground: houseGroundExtent, build: buildHouse },
  { id: 'turm', label: 'Turm', category: 'gebaeude', kind: 'decorative', styled: true, seeded: true, ground: towerExtent, build: buildTower },
  { id: 'brunnen', label: 'Brunnen', category: 'gebaeude', kind: 'decorative', styled: true, seeded: true, formsFor: wellForms, ground: wellExtent, build: buildWell },
  { id: 'bruecke', label: 'Brücke', category: 'gebaeude', kind: 'decorative', styled: true, seeded: true, sized: false, formsFor: bridgeForms, ground: bridgeExtent, build: buildBridge },
  { id: 'marktstand', label: 'Marktstand', category: 'deko', kind: 'decorative', styled: true, seeded: false, ground: stallExtent, build: buildStall },
  ...DEKO.map((d): CatalogEntry => ({ id: d.id, label: d.label, category: 'deko', kind: 'decorative', styled: true, seeded: d.seeded, sized: d.sized, ground: d.ground, build: d.build })),
  // alte Laterne bleibt baubar für gespeicherte Bauwerke, gewählt wird jetzt der Laternenpfahl
  { id: 'laterne', label: 'Laterne', category: 'deko', kind: 'decorative', styled: true, seeded: false, build: buildLamp, hidden: true },
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
