// Alle Bauwerk-Typen. Jeder erzeugt aus seiner Quelle (Generator, Version, Seed, Parameter)
// immer dasselbe Bauwerk, deshalb speichert die App nur die Quelle.

import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { TEST_HOUSE_ID, testHouse } from './decorative/test-house'

export interface CatalogEntry {
  id: string
  label: string
  kind: 'decorative' | 'functional'
  build(source: BlueprintSource): Blueprint
}

export const CATALOG: CatalogEntry[] = [
  { id: TEST_HOUSE_ID, label: 'Testhaus', kind: 'decorative', build: () => testHouse() },
]

export function buildFromSource(source: BlueprintSource): Blueprint {
  const entry = CATALOG.find(e => e.id === source.generator)
  if (!entry) throw new Error(`Unbekannter Bauwerk-Typ: ${source.generator}`)
  return entry.build(source)
}
