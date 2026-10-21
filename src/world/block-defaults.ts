// Standardwerte der Block-Properties (Datengenerator-Report). Ab 26.3 lässt das Spiel sie in Chunks weg,
// wenn ein Block im Standardzustand ist – die App ergänzt sie, damit jeder Blockstate vollständig ist.

import blocks from '../../data/blocks-26.1.json'
import { formatState, shortName, type BlockState, type Props } from '../blueprint/blockstate'

const DEFAULTS = (blocks as unknown as { defaults: Record<string, Record<string, string>> }).defaults

export function withDefaults(name: string, props?: Props): BlockState {
  const d = DEFAULTS[shortName(name.includes(':') ? name : `minecraft:${name}`)]
  return formatState(name, d ? { ...d, ...props } : props)
}

export function defaultsOf(name: string): Props {
  return DEFAULTS[shortName(name)] ?? {}
}
