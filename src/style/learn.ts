// Palette aus dem lernen, was schon gebaut ist: Blöcke in einem Bereich zählen, Natur weglassen,
// nach Material und Form auf die Rollen verteilen. Was fehlt, kommt aus der ähnlichsten fertigen Palette.

import { parseState, shortName, type BlockState } from '../blueprint/blockstate'
import { exists, hasForms, isNatural, materialOf } from './blocks'
import { NEEDS, PALETTES, type Palette, type Role, type Weighted } from './palettes'

const FORM_SUFFIX = /_(stairs|slab|wall|fence|fence_gate|door|trapdoor|button|pressure_plate)$/

/** stone_brick_stairs → stone_bricks, oak_slab → oak_planks */
export function baseOf(id: string): string {
  const s = shortName(id)
  const m = FORM_SUFFIX.exec(s)
  if (!m) return s
  const stem = s.slice(0, -m[0].length)
  for (const cand of [`${stem}s`, `${stem}_planks`, `${stem}_block`, stem]) if (exists(cand) && !FORM_SUFFIX.test(cand)) return cand
  return s
}

export interface LearnResult {
  palette: Palette
  counted: number
  roles: Partial<Record<Role, string>>
}

export function learnPalette(states: Iterable<[BlockState, number]>, style: string, name: string): LearnResult | null {
  const full = new Map<string, number>()
  const stairs = new Map<string, number>()
  const special = { window: new Map<string, number>(), door: new Map<string, number>(), light: new Map<string, number>(), accent: new Map<string, number>() }
  let counted = 0
  for (const [state, n] of states) {
    const id = shortName(parseState(state).name)
    if (isNatural(id) || id === 'air' || id === 'cave_air') continue
    counted += n
    if (/glass/.test(id)) inc(special.window, id, n)
    else if (id.endsWith('_door')) inc(special.door, id, n)
    else if (/lantern|torch|lamp|froglight|glowstone|shroomlight/.test(id)) inc(special.light, id.replace('wall_', ''), n)
    else if (/_wool$/.test(id)) inc(special.accent, id, n)
    else if (/_stairs$|_slab$/.test(id)) inc(stairs, baseOf(id), n)
    else if (!FORM_SUFFIX.test(id)) inc(full, id, n)
  }
  if (counted < 20) return null

  const byCount = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
  const fulls = byCount(full)
  const roles: Partial<Record<Role, string>> = {}
  const take = (role: Role, pred: (id: string) => boolean, from = fulls) => {
    const id = from.find(i => pred(i) && !Object.values(roles).includes(i))
    if (id) roles[role] = id
  }
  take('roof', id => hasForms(id, NEEDS.roof!), byCount(stairs))
  take('trim', id => hasForms(id, NEEDS.trim!), byCount(stairs))
  take('frame', id => /_log$|_wood$|_stem$|_hyphae$/.test(id))
  take('wall', id => ['stone', 'brick', 'wood', 'other'].includes(materialOf(id)))
  take('sockel', id => ['stone', 'brick'].includes(materialOf(id)) && hasForms(id, NEEDS.sockel!))
  take('floor', id => /_planks$/.test(id))
  take('detail', id => hasForms(id, NEEDS.detail!))
  const top = (m: Map<string, number>) => byCount(m)[0]
  if (top(special.window)) roles.window = top(special.window)
  if (top(special.door)) roles.door = top(special.door)
  if (top(special.light)) roles.light = top(special.light)
  if (top(special.accent)) roles.accent = top(special.accent)

  // Ähnlichste fertige Palette als Ergänzung
  const base = [...PALETTES].sort((a, b) => overlap(b, roles) - overlap(a, roles) || (a.style === style ? -1 : 1))[0]
  const out = {} as Record<Role, Weighted[]>
  for (const role of Object.keys(base.roles) as Role[]) {
    const id = roles[role]
    out[role] = id && exists(id) ? [{ id, w: 1 }] : base.roles[role]
  }
  return {
    palette: { id: `eigen-${Date.now().toString(36)}`, name, style, mood: base.mood, roles: out, custom: true },
    counted,
    roles,
  }
}

function inc(m: Map<string, number>, k: string, n: number): void {
  m.set(k, (m.get(k) ?? 0) + n)
}

function overlap(p: Palette, roles: Partial<Record<Role, string>>): number {
  let n = 0
  for (const [role, id] of Object.entries(roles)) if (p.roles[role as Role]?.some(w => w.id === id)) n++
  return n
}
