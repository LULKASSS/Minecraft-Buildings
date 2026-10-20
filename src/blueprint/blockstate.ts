// Blockstate als Text: "minecraft:oak_stairs[facing=north,half=bottom]".
// Kanonisch heißt: Namensraum immer dabei, Properties alphabetisch.

export type BlockState = string
export type Props = Record<string, string>

export interface ParsedState {
  name: string
  props: Props
}

export const AIR: BlockState = 'minecraft:air'

export function parseState(state: string): ParsedState {
  const open = state.indexOf('[')
  const rawName = (open < 0 ? state : state.slice(0, open)).trim()
  const name = rawName.includes(':') ? rawName : `minecraft:${rawName}`
  const props: Props = {}
  if (open >= 0) {
    const body = state.slice(open + 1, state.lastIndexOf(']'))
    for (const part of body.split(',')) {
      if (!part.trim()) continue
      const [k, v] = part.split('=')
      props[k.trim()] = (v ?? '').trim()
    }
  }
  return { name, props }
}

export function formatState(name: string, props: Props = {}): BlockState {
  const full = name.includes(':') ? name : `minecraft:${name}`
  const keys = Object.keys(props).sort()
  if (keys.length === 0) return full
  return `${full}[${keys.map(k => `${k}=${props[k]}`).join(',')}]`
}

export function canonical(state: string): BlockState {
  const p = parseState(state)
  return formatState(p.name, p.props)
}

/** Name ohne "minecraft:" für Anzeige und Tabellen. */
export function shortName(name: string): string {
  return name.startsWith('minecraft:') ? name.slice(10) : name
}

export function isAir(state: string): boolean {
  const n = parseState(state).name
  return n === 'minecraft:air' || n === 'minecraft:cave_air' || n === 'minecraft:void_air'
}
