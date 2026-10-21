// Kleinere Bauwerke im Stil: Turm, Brunnen, Laterne, Marktstand.

import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { Builder, groundAt, randInt, rng, type Facing, type Ground } from '../style/builder'
import { getPalette } from '../style/palettes'
import { styleById, type Size } from './styles'

export interface StyledParams {
  style: string
  palette: string
  size: Size
  ground?: Ground
}

export function setup(source: BlueprintSource) {
  const p = source.params as unknown as StyledParams
  const st = styleById(p.style)
  const pal = getPalette(p.palette) ?? getPalette(st.palettes[0])!
  const b = new Builder(pal, source.seed)
  const r = rng(source.seed * 104729 + 7)
  return { p, st, b, r, g: p.ground }
}

/** Gelände unter einer Fläche auffüllen (nur über dem Geländeblock, nie darunter). */
export function foundation(b: Builder, g: Ground | undefined, cells: [number, number][]): void {
  for (const [x, z] of cells) {
    const gy = Math.max(-10, groundAt(g, x, z))
    for (let y = gy + 1; y < 0; y++) b.role(x, y, z, 'sockel', {}, 1)
  }
}

export function facingTo(dx: number, dz: number): Facing {
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north'
}

// ---------- Turm ----------

const TOWER = { S: [3, 11], M: [4, 15], L: [5, 19] } as const

export function towerExtent(source: BlueprintSource) {
  const r = TOWER[(source.params as unknown as StyledParams).size][0] + 2
  return { x0: -r, z0: -r, x1: r, z1: r + 2 }
}

export function buildTower(source: BlueprintSource): Blueprint {
  const { p, st, b, r, g } = setup(source)
  const rad: number = TOWER[p.size][0]
  const h0: number = TOWER[p.size][1]
  const H = h0 + randInt(r, 0, 3)
  const inC = (x: number, z: number, rr = rad) => x * x + z * z <= (rr + 0.5) * (rr + 0.5)
  const cells: [number, number][] = []
  for (let z = -rad; z <= rad; z++) for (let x = -rad; x <= rad; x++) if (inC(x, z)) cells.push([x, z])
  const edge = ([x, z]: [number, number]) => !inC(x + 1, z) || !inC(x - 1, z) || !inC(x, z + 1) || !inC(x, z - 1)
  foundation(b, g, cells)
  const floors: number[] = []
  for (let y = 0; y < H; y += 5) floors.push(y)
  for (const c of cells) {
    const [x, z] = c
    if (edge(c)) for (let y = 0; y <= H; y++) b.role(x, y, z, y < 3 ? 'sockel' : 'wall', {}, 2)
    else {
      for (const y of floors) b.role(x, y, z, 'floor')
      b.role(x, H, z, 'floor') // Decke unter dem Dach
    }
  }
  // Fensterschlitze in alle vier Richtungen je Stockwerk, Tür im Süden
  for (const y of floors) {
    for (const [x, z] of [[0, -rad], [rad, 0], [-rad, 0], [0, rad]] as [number, number][]) {
      if (y === 0 && z === rad) continue
      b.role(x, y + 2, z, 'window')
      b.role(x, y + 3, z, 'window')
    }
  }
  const door = b.main('door')
  b.set(0, 1, rad, `${door}[facing=north,half=lower,hinge=left]`)
  b.set(0, 2, rad, `${door}[facing=north,half=upper,hinge=left]`)
  b.form(0, 0, rad + 1, 'sockel', 'stairs', { facing: 'north', half: 'bottom' })
  // Leiter an der Nordwand innen
  for (let y = 1; y <= floors[floors.length - 1]; y++) b.set(0, y, -rad + 1, 'minecraft:ladder[facing=south]')
  for (const y of floors) if (y + 5 <= H) b.set(1, y + 4, 0, `${b.main('light')}[hanging=true]`)
  // Dach
  const top = H + 1
  if (st.roof === 'flat' || st.roof === 'parapet') {
    for (const c of cells) {
      b.role(c[0], H, c[1], 'roof')
      if (edge(c)) {
        b.role(c[0], top, c[1], 'wall')
        if ((c[0] + c[1]) % 2 === 0) b.form(c[0], top + 1, c[1], 'trim', 'slab', { type: 'bottom' })
      }
    }
  } else if (st.roof === 'pagoda') {
    for (let i = 0; i <= rad + 2; i++) {
      const rr = rad + 2 - i
      const y = top + Math.floor(i / 2)
      for (let z = -rr; z <= rr; z++)
        for (let x = -rr; x <= rr; x++) {
          if (!inC(x, z, rr) || (rr > 0 && inC(x, z, rr - 1))) continue
          b.form(x, y, z, i === 0 ? 'trim' : 'roof', 'slab', { type: i % 2 === 0 ? 'bottom' : 'top' })
        }
    }
  } else {
    // Kegeldach aus Treppen, Spitze als Stufe
    for (let i = 0; i <= rad + 1; i++) {
      const rr = rad + 1 - i
      const y = H + i
      for (let z = -rr; z <= rr; z++)
        for (let x = -rr; x <= rr; x++) {
          if (!inC(x, z, rr) || (rr > 0 && inC(x, z, rr - 1))) continue
          if (rr === 0) b.form(x, y, z, 'trim', 'slab', { type: 'bottom' })
          else b.form(x, y, z, i === 0 ? 'trim' : 'roof', 'stairs', { facing: facingTo(-x, -z), half: 'bottom' })
        }
    }
  }
  return b.toBlueprint(`Turm (${st.label})`, source)
}

// ---------- Brunnen ----------

const WELL: Record<Size, number> = { S: 2, M: 3, L: 4 }

export function wellExtent(source?: BlueprintSource) {
  const R = WELL[((source?.params as unknown as StyledParams | undefined)?.size) ?? 'M'] + 2
  return { x0: -R, z0: -R, x1: R, z1: R }
}

/** Achteck mit Halbmesser R (Ecken abgeschnitten); Modern bleibt eckig. */
function octagon(R: number, square: boolean): (x: number, z: number) => boolean {
  return (x, z) => Math.abs(x) <= R && Math.abs(z) <= R && (square || Math.abs(x) + Math.abs(z) <= R + Math.ceil(R / 2))
}

export function buildWell(source: BlueprintSource): Blueprint {
  const { p, st, b, g } = setup(source)
  const R = WELL[p.size]
  const square = st.id === 'modern' || st.id === 'japan'
  const inBasin = octagon(R, square), inPave = octagon(R + 1, square)
  const cells: [number, number][] = []
  for (let z = -R - 1; z <= R + 1; z++) for (let x = -R - 1; x <= R + 1; x++) if (inPave(x, z)) cells.push([x, z])
  foundation(b, g, cells)
  const rim = (x: number, z: number) => inBasin(x, z) && (!inBasin(x + 1, z) || !inBasin(x - 1, z) || !inBasin(x, z + 1) || !inBasin(x, z - 1))
  // Becken: Steinkante, Wasser zwei tief, Pflaster ringsum
  for (const [x, z] of cells) {
    if (!inBasin(x, z)) b.role(x, 0, z, 'path')
    else if (rim(x, z)) {
      b.role(x, 0, z, 'sockel', {}, 1)
      if (st.id === 'wueste') {
        b.role(x, 1, z, 'sockel', {}, 0)
        b.form(x, 2, z, 'trim', 'slab', { type: 'bottom' })
      } else if (st.id === 'modern') b.form(x, 1, z, 'trim', 'slab', { type: 'bottom' })
      else b.form(x, 1, z, 'sockel', 'stairs', { facing: facingTo(-x, -z), half: 'bottom' })
    } else {
      b.set(x, 0, z, 'minecraft:water[level=0]')
      b.set(x, -1, z, 'minecraft:water[level=0]')
      b.role(x, -2, z, 'sockel', {}, 0)
    }
  }
  const light = b.main('light')

  if (st.id === 'modern') {
    // Springbrunnen: Säule in der Mitte, oben quillt Wasser heraus
    for (let y = -1; y <= 2; y++) b.role(0, y, 0, 'trim')
    b.set(0, 3, 0, 'minecraft:water[level=0]')
    for (const [x, z] of [[-R - 1, -R - 1], [R + 1, -R - 1], [-R - 1, R + 1], [R + 1, R + 1]] as [number, number][]) {
      b.role(x, 1, z, 'trim')
      b.set(x, 2, z, `${light}[hanging=false]`)
    }
    return b.toBlueprint(`Springbrunnen (${st.label})`, source)
  }

  if (st.id === 'wueste') {
    // vier Pfeiler, Sonnendach aus Stoff in Streifen, Laterne darunter
    const accents = b.palette!.roles.accent.map(a => a.id)
    for (const [x, z] of [[-R, 0], [R, 0], [0, -R], [0, R]] as [number, number][]) {
      b.role(x, 2, z, 'sockel', {}, 0)
      for (let y = 3; y <= 4; y++) b.role(x, y, z, 'wall', {}, 0)
    }
    for (let z = -R; z <= R; z++)
      for (let x = -R; x <= R; x++) {
        if (!inBasin(x, z)) continue
        b.set(x, 5, z, `minecraft:${accents[(x + R) % accents.length]}`)
        if (rim(x, z)) b.form(x, 6, z, 'trim', 'slab', { type: 'bottom' })
      }
    b.set(0, 4, 0, `${light}[hanging=true]`)
    b.set(R + 1, 1, R + 1 - Math.ceil(R / 2), 'minecraft:potted_cactus')
    return b.toBlueprint(`Brunnen (${st.label})`, source)
  }

  // Pfosten auf der Kante, Firstbalken, Satteldach (Japan: flache Stufen mit hochgezogenen Ecken).
  // Dach schmal und hoch genug, damit man Becken und Winde sieht.
  const japan = st.id === 'japan'
  const top = 6 // Firstbalken
  for (const x of [-R, R]) {
    b.role(x, 1, 0, 'sockel', {}, 0)
    for (let y = 2; y < top; y++) b.beam(x, y, 0, 'frame', 'y')
  }
  for (let x = -R - 1; x <= R + 1; x++) b.beam(x, top, 0, 'frame', 'x')
  const half = 2
  for (let x = -R - 1; x <= R + 1; x++) {
    b.form(x, top + 1, 0, 'trim', 'slab', { type: 'bottom' })
    for (let k = 1; k <= half; k++) {
      if (japan) {
        b.form(x, top, -k, k === half ? 'trim' : 'roof', 'slab', { type: k === half ? 'bottom' : 'top' })
        b.form(x, top, k, k === half ? 'trim' : 'roof', 'slab', { type: k === half ? 'bottom' : 'top' })
      } else {
        b.form(x, top + 1 - k, -k, k === half ? 'trim' : 'roof', 'stairs', { facing: 'south', half: 'bottom' })
        b.form(x, top + 1 - k, k, k === half ? 'trim' : 'roof', 'stairs', { facing: 'north', half: 'bottom' })
      }
    }
  }
  if (japan) for (const x of [-R - 1, R + 1]) for (const z of [-half, half]) b.form(x, top, z, 'trim', 'slab', { type: 'top' })
  // Laternen unter den Balkenenden
  b.set(-R - 1, top - 1, 0, `${light}[hanging=true]`)
  b.set(R + 1, top - 1, 0, `${light}[hanging=true]`)
  if (japan) {
    // Bambusrohr als Wasserspeier (Tsukubai) statt Winde
    b.set(0, 1, -R - 1, 'minecraft:stripped_bamboo_block[axis=y]')
    b.set(0, 2, -R - 1, 'minecraft:stripped_bamboo_block[axis=y]')
    b.set(0, 2, -R, 'minecraft:stripped_bamboo_block[axis=z]')
    b.form(0, 3, -R - 1, 'trim', 'slab', { type: 'bottom' })
  } else {
    // Winde zwischen den Pfosten, Kette mit Eimer (Kessel) über dem Wasser
    for (let x = -R + 1; x <= R - 1; x++) b.beam(x, top - 2, 0, 'frame', 'x')
    const chain = st.id === 'steampunk' ? 'minecraft:copper_chain[axis=y]' : 'minecraft:iron_chain[axis=y]'
    for (let y = 2; y < top - 2; y++) b.set(0, y, 0, chain)
    b.set(0, 1, 0, 'minecraft:water_cauldron[level=3]')
    if (st.id === 'steampunk') b.set(0, top + 2, 0, 'minecraft:lightning_rod[facing=up]')
  }
  return b.toBlueprint(`Brunnen (${st.label})`, source)
}

// ---------- Laterne ----------

export function buildLamp(source: BlueprintSource): Blueprint {
  const { p, st, b } = setup(source)
  const h = { S: 3, M: 4, L: 5 }[p.size]
  const light = b.main('light')
  if (st.id === 'japan') {
    // Steinlaterne (Tōrō)
    b.role(0, 0, 0, 'sockel', {}, 0)
    try {
      b.form(0, 1, 0, 'sockel', 'wall')
    } catch {
      b.set(0, 1, 0, 'minecraft:stone_brick_wall') // Sockel-Material ohne Mauer-Form
    }
    b.form(0, 2, 0, 'sockel', 'slab', { type: 'top' }) // obere Stufe: volle Oberseite, darauf hält die Laterne
    b.set(0, 3, 0, `${light}[hanging=false]`)
    b.form(0, 4, 0, 'trim', 'slab', { type: 'bottom' })
    return b.toBlueprint('Steinlaterne', source)
  }
  b.role(0, 0, 0, 'sockel', {}, 0)
  for (let y = 1; y <= h; y++) b.form(0, y, 0, 'detail', 'fence')
  b.form(1, h, 0, 'detail', 'fence')
  b.set(1, h - 1, 0, `${light}[hanging=true]`)
  b.form(0, h + 1, 0, 'trim', 'slab', { type: 'bottom' })
  return b.toBlueprint(`Laterne (${st.label})`, source)
}

// ---------- Marktstand ----------

const STALL = { S: [5, 3], M: [7, 3], L: [7, 5] } as const

export function stallExtent(source: BlueprintSource) {
  const [w, d] = STALL[(source.params as unknown as StyledParams).size]
  return { x0: -Math.floor(w / 2) - 1, z0: -Math.floor(d / 2) - 1, x1: Math.floor(w / 2) + 1, z1: Math.floor(d / 2) + 1 }
}

export function buildStall(source: BlueprintSource): Blueprint {
  const { p, st, b, g } = setup(source)
  const [w, d] = STALL[p.size]
  const hx = Math.floor(w / 2), hz = Math.floor(d / 2)
  const cells: [number, number][] = []
  for (let z = -hz; z <= hz; z++) for (let x = -hx; x <= hx; x++) cells.push([x, z])
  foundation(b, g, cells)
  for (const [x, z] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) for (let y = 1; y <= 3; y++) b.form(x, y, z, 'detail', 'fence')
  // Stoffdach in Streifen, vorne Kante aus Stufen
  const accents = b.palette!.roles.accent.map(a => a.id)
  for (let z = -hz; z <= hz; z++)
    for (let x = -hx; x <= hx; x++) b.set(x, 4, z, `minecraft:${accents[Math.abs(x) % accents.length]}`)
  for (let x = -hx; x <= hx; x++) b.form(x, 4, hz + 1, 'detail', 'slab', { type: 'top' })
  // Theke vorne, Fässer und Kisten hinten
  for (let x = -hx + 1; x <= hx - 1; x++) b.form(x, 1, hz, 'detail', 'slab', { type: 'top' })
  for (let x = -hx + 1; x <= hx - 1; x += 2) b.set(x, 1, -hz, 'minecraft:barrel[facing=up]')
  if (w >= 7) b.set(0, 1, -hz, 'minecraft:hay_block[axis=y]')
  b.set(0, 3, 0, `${b.main('light')}[hanging=true]`)
  return b.toBlueprint(`Marktstand (${st.label})`, source)
}
