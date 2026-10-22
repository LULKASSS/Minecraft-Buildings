// Entwürfe (Fassung 15): gemerkte Varianten und alles, was schon einmal gesetzt wurde. Gespeichert wird nur die
// Quelle (Generator, Version, Seed, Parameter), nie der Blockhaufen – gleiche Quelle, gleiches Bauwerk.
// Bleibt im Browser (IndexedDB), gilt für alle Welten.

import type { BlueprintSource } from '../blueprint/blueprint'
import * as store from './store'

export interface Draft {
  id: string
  name: string
  source: BlueprintSource
  added: number
  /** schon einmal in eine Welt gesetzt */
  placed?: boolean
}

let list: Draft[] = []

export async function loadDrafts(): Promise<void> {
  list = (await store.get<Draft[]>('kv', 'drafts')) ?? []
}

export function drafts(): Draft[] {
  return list
}

/** Quelle ohne Ortsbezug (Gelände). Bauwerke, die nur an ihrer Stelle Sinn ergeben (Weg, Woll-Grundriss), nie. */
function clean(src: BlueprintSource): BlueprintSource | null {
  const { ground: _g, path, footprint, ...params } = src.params as Record<string, unknown>
  void _g
  if (path || footprint || src.generator === 'vorlage') return null
  return { ...src, params }
}

const keyOf = (src: BlueprintSource) => JSON.stringify(src)

export function draftOf(src: BlueprintSource): Draft | null {
  const c = clean(src)
  return c ? list.find(d => keyOf(d.source) === keyOf(c)) ?? null : null
}

function save(): void {
  void store.put('kv', 'drafts', list)
}

/** Stern an einer Variante: merken oder wieder vergessen. */
export function toggleDraft(src: BlueprintSource, name: string): boolean {
  const c = clean(src)
  if (!c) return false
  const hit = draftOf(c)
  if (hit) list = list.filter(d => d !== hit)
  else list = [{ id: `d-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, name, source: c, added: Date.now() }, ...list]
  save()
  return !hit
}

/** Beim Setzen automatisch merken (oben in der Liste). */
export function rememberPlaced(src: BlueprintSource, name: string): void {
  const c = clean(src)
  if (!c) return
  const hit = draftOf(c)
  if (hit) {
    hit.placed = true
    list = [hit, ...list.filter(d => d !== hit)]
  } else list = [{ id: `d-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, name, source: c, added: Date.now(), placed: true }, ...list]
  save()
}

export function removeDraft(id: string): void {
  list = list.filter(d => d.id !== id)
  save()
}
