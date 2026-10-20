// Vorlagen (Farmen, Redstone) bleiben im Browser: IndexedDB, nie im Repo.

import { readLitematic, registerTemplates, templateList, type TemplateData } from '../catalog/template'
import * as store from './store'

export async function loadTemplates(): Promise<void> {
  registerTemplates((await store.get<TemplateData[]>('kv', 'templates')) ?? [])
}

export async function importTemplate(file: File): Promise<TemplateData> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const t: TemplateData = { ...readLitematic(bytes, file.name.replace(/\.litematic$/i, '')), id: `t-${Date.now().toString(36)}`, added: Date.now() }
  const list = [...templateList(), t]
  registerTemplates(list)
  await store.put('kv', 'templates', list)
  return t
}

export async function removeTemplate(id: string): Promise<void> {
  const list = templateList().filter(t => t.id !== id)
  registerTemplates(list)
  await store.put('kv', 'templates', list)
}

/** Grobe Zuordnung Datenversion → Spielversion, für die Warnung bei abweichender Weltversion. */
export function versionName(dataVersion: number): string {
  const known: [number, string][] = [[5023, '26.3'], [4903, '26.2'], [4786, '26.1'], [4671, '1.21.11'], [4556, '1.21.10'], [4440, '1.21.8'], [4325, '1.21.5'], [4189, '1.21.4'], [3953, '1.21']]
  const hit = known.find(([v]) => dataVersion >= v)
  return hit ? (dataVersion === hit[0] ? hit[1] : `${hit[1]}+`) : `Datenversion ${dataVersion}`
}
