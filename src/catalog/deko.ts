// Deko zum Setzen rund ums Haus: Bank, Gemüsegarten, Beet, Feuerstelle, Pavillon, Lager, Laternenpfahl, Torbogen.
// Alles im Stil und in der Palette, Anker in der Mitte am Boden, y = 0 ist der Geländeblock (wird ersetzt),
// vorne ist Süden (+z). Was auf dem Boden steht, bekommt einen Untergrund aus Wegblöcken: Deko braucht einen Platz.

import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import { formOf } from '../style/blocks'
import { Builder, type Facing, type Ground } from '../style/builder'
import { facingTo, foundation, setup } from './small'
import type { Extent } from './index'
import type { Size } from './styles'

type Cell = [number, number]

function rect(x0: number, z0: number, x1: number, z1: number): Cell[] {
  const out: Cell[] = []
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push([x, z])
  return out
}

/** Platz unter der Deko: Gelände auffüllen, oben Wegblöcke. */
function pad(b: Builder, g: Ground | undefined, cells: Cell[], role: 'path' | 'sockel' | 'floor' = 'path'): void {
  foundation(b, g, cells)
  for (const [x, z] of cells) b.role(x, 0, z, role, {}, 1)
}

/** Mauer-Form eines Blocks; ohne eigene Mauer die des Grundsteins (poliert/glatt weg), sonst Steinziegelmauer. */
function wallId(id: string): string {
  const short = id.replace('minecraft:', '')
  return (
    formOf(short, 'wall') ??
    formOf(short.replace(/^(polished|smooth|cut|chiseled)_/, ''), 'wall') ??
    formOf(short.replace(/_bricks?$/, ''), 'wall') ??
    'minecraft:stone_brick_wall'
  )
}

const OUT: Record<Facing, Cell> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }

/** Falltür als Seitenwand: liegt an der Seite, die zur Mitte zeigt (facing = nach außen). */
function sidePanel(b: Builder, x: number, y: number, z: number, out: Facing, id?: string): void {
  if (id) b.set(x, y, z, `${id}[facing=${out},half=bottom,open=true]`)
  else b.form(x, y, z, 'detail', 'trapdoor', { facing: out, half: 'bottom', open: 'true' })
}

const FLOWERS: Record<string, string[]> = {
  mittelalter: ['poppy', 'dandelion', 'oxeye_daisy', 'cornflower', 'azure_bluet', 'red_tulip', 'white_tulip', 'allium'],
  japan: ['fern', 'azalea', 'flowering_azalea', 'lily_of_the_valley', 'pink_tulip', 'allium'],
  modern: ['fern', 'azalea', 'short_grass', 'allium', 'white_tulip', 'lily_of_the_valley'],
  wueste: ['dead_bush', 'short_dry_grass', 'allium', 'orange_tulip', 'torchflower', 'dead_bush'],
  steampunk: ['fern', 'red_tulip', 'poppy', 'allium', 'short_grass', 'azure_bluet'],
}
const TALL: Record<string, string[]> = {
  mittelalter: ['rose_bush', 'peony', 'lilac'],
  japan: ['peony', 'lilac'],
  modern: ['large_fern'],
  wueste: ['tall_dry_grass'],
  steampunk: ['rose_bush', 'large_fern'],
}
const SOIL: Record<string, string> = { mittelalter: 'dirt', japan: 'moss_block', modern: 'podzol', wueste: 'coarse_dirt', steampunk: 'rooted_dirt' }
const POTS: Record<string, string[]> = {
  mittelalter: ['potted_red_tulip', 'potted_poppy', 'potted_cornflower'],
  japan: ['potted_bamboo', 'potted_azalea_bush', 'potted_fern'],
  modern: ['potted_fern', 'potted_azalea_bush', 'potted_bamboo'],
  wueste: ['potted_cactus', 'potted_dead_bush', 'potted_cactus'],
  steampunk: ['potted_fern', 'potted_red_tulip', 'potted_cornflower'],
}

/** Pflanze auf Erde: einfach oder zweiteilig (Rosenbusch, Pfingstrose …). */
function plant(b: Builder, x: number, y: number, z: number, style: string, r: () => number, tallChance = 0.25): void {
  const tall = TALL[style] ?? []
  if (tall.length && r() < tallChance) {
    const id = tall[Math.floor(r() * tall.length)]
    b.set(x, y, z, `minecraft:${id}[half=lower]`)
    b.set(x, y + 1, z, `minecraft:${id}[half=upper]`)
    return
  }
  const list = FLOWERS[style] ?? FLOWERS.mittelalter
  b.set(x, y, z, `minecraft:${list[Math.floor(r() * list.length)]}`)
}

function pot(b: Builder, x: number, y: number, z: number, style: string, r: () => number): void {
  const list = POTS[style] ?? POTS.mittelalter
  b.set(x, y, z, `minecraft:${list[Math.floor(r() * list.length)]}`)
}

/** Kette (Kupfer im Steampunk) */
function chainId(style: string): string {
  return style === 'steampunk' ? 'minecraft:copper_chain' : 'minecraft:iron_chain'
}

// ---------- Bank ----------

export function benchExtent(source: BlueprintSource): Extent {
  const n = ({ S: 2, M: 3, L: 4 } as Record<Size, number>)[(source.params as { size: Size }).size]
  return { x0: -n, z0: -2, x1: n + 1, z1: 1 }
}

export function buildBench(source: BlueprintSource): Blueprint {
  const { p, st, b, r, g } = setup(source)
  const len = ({ S: 2, M: 3, L: 4 } as Record<Size, number>)[p.size]
  const x0 = -Math.floor((len - 1) / 2), x1 = x0 + len - 1
  pad(b, g, rect(x0 - 1, -1, x1 + 1, 1))
  for (let x = x0; x <= x1; x++) {
    if (st.id === 'modern') b.form(x, 1, 0, 'trim', 'slab', { type: 'top' })
    else if (st.id === 'japan') b.form(x, 1, 0, 'detail', 'slab', { type: 'top' })
    else b.form(x, 1, 0, st.id === 'wueste' ? 'sockel' : 'detail', 'stairs', { facing: 'north', half: 'bottom' })
  }
  // Enden: Armlehnen bzw. Wangen
  for (const [x, out] of [[x0 - 1, 'west'], [x1 + 1, 'east']] as [number, Facing][]) {
    if (st.id === 'modern') b.role(x, 1, 0, 'frame', { axis: 'y' })
    else if (st.id === 'japan') b.beam(x, 1, 0, 'frame', 'y')
    else if (st.id === 'wueste') b.role(x, 1, 0, 'sockel', {}, 0)
    else if (st.id === 'steampunk') sidePanel(b, x, 1, 0, out, 'minecraft:waxed_copper_trapdoor')
    else sidePanel(b, x, 1, 0, out)
  }
  // Wüste: Kissen als Krug daneben; Japan/Modern: Topfpflanze auf der Wange; sonst ab M ein Fass mit Blume
  if (st.id === 'wueste') pot(b, x1 + 1, 2, 0, st.id, r)
  else if (st.id === 'japan' || st.id === 'modern') pot(b, x1 + 1, 2, 0, st.id, r)
  else if (p.size !== 'S') {
    b.set(x1 + 1, 1, -1, 'minecraft:barrel[facing=up]')
    pot(b, x1 + 1, 2, -1, st.id, r)
  }
  // Groß: Laterne auf einem Pfosten hinter der Bank
  if (p.size === 'L') {
    b.form(x0 - 1, 1, -1, 'detail', 'fence')
    b.form(x0 - 1, 2, -1, 'detail', 'fence')
    b.set(x0 - 1, 3, -1, `${b.main('light')}[hanging=false]`)
  }
  return b.toBlueprint(`Bank (${st.label})`, source)
}

// ---------- Gemüsegarten ----------

const GARDEN: Record<Size, number> = { S: 2, M: 3, L: 4 }
const CROPS = ['wheat[age=7]', 'carrots[age=7]', 'potatoes[age=7]', 'beetroots[age=3]']

export function gardenExtent(source: BlueprintSource): Extent {
  const h = GARDEN[(source.params as { size: Size }).size] + 2
  return { x0: -h, z0: -h, x1: h, z1: h + 1 }
}

export function buildGarden(source: BlueprintSource): Blueprint {
  const { p, st, b, r, g } = setup(source)
  const h = GARDEN[p.size]
  const f = h + 1
  foundation(b, g, rect(-f, -f, f, f))
  // Rahmen aus Stämmen, darauf ein Zaun mit Tor vorne
  for (let z = -f; z <= f; z++)
    for (let x = -f; x <= f; x++) {
      const edge = Math.abs(x) === f || Math.abs(z) === f
      if (!edge) continue
      const corner = Math.abs(x) === f && Math.abs(z) === f
      b.beam(x, 0, z, 'frame', corner ? 'y' : Math.abs(z) === f ? 'x' : 'z')
      if (x === 0 && z === f) b.set(x, 1, z, `${formOf(b.main('detail'), 'fence_gate') ?? 'minecraft:oak_fence_gate'}[facing=south]`)
      else b.form(x, 1, z, 'detail', 'fence')
    }
  // Ackerboden, Wasserrinne in der Mitte (bewässert 4 Blöcke weit), Reihen mit reifen Pflanzen
  const offset = Math.floor(r() * 4)
  for (let z = -h; z <= h; z++)
    for (let x = -h; x <= h; x++) {
      if (z === 0) {
        b.set(x, 0, z, 'minecraft:water[level=0]')
        continue
      }
      b.set(x, 0, z, 'minecraft:farmland[moisture=7]')
      const band = Math.floor((Math.abs(z) - 1) / 2) + (z < 0 ? 2 : 0)
      b.set(x, 1, z, `minecraft:${CROPS[(band + offset) % CROPS.length]}`)
    }
  // Seerosen auf der Rinne, wo sie nicht im Weg sind
  if (h >= 3) for (const x of [-h + 1, h - 1]) b.set(x, 1, 0, 'minecraft:lily_pad')
  // Vogelscheuche ab M
  if (p.size !== 'S') {
    const sx = h - 1, sz = -(h - 1)
    b.form(sx, 1, sz, 'detail', 'fence')
    b.set(sx, 2, sz, 'minecraft:hay_block[axis=y]')
    b.set(sx, 3, sz, 'minecraft:carved_pumpkin[facing=south]')
    b.form(sx - 1, 2, sz, 'detail', 'fence')
    b.form(sx + 1, 2, sz, 'detail', 'fence')
  }
  // Weg zum Tor, groß: Komposter und Fass an der Ecke
  b.role(0, 0, f + 1, 'path')
  foundation(b, g, [[0, f + 1]])
  if (p.size === 'L') {
    foundation(b, g, [[f + 1, f], [f + 1, f - 1]])
    b.role(f + 1, 0, f, 'path')
    b.role(f + 1, 0, f - 1, 'path')
    b.set(f + 1, 1, f, 'minecraft:composter[level=4]')
    b.set(f + 1, 1, f - 1, 'minecraft:barrel[facing=up]')
  }
  return b.toBlueprint(`Gemüsegarten (${st.label})`, source)
}

// ---------- Beet ----------

const BED: Record<Size, [number, number]> = { S: [3, 1], M: [4, 2], L: [6, 2] }

export function bedExtent(source: BlueprintSource): Extent {
  const [w, d] = BED[(source.params as { size: Size }).size]
  return { x0: -Math.ceil(w / 2) - 1, z0: -Math.ceil(d / 2) - 1, x1: Math.ceil(w / 2) + 1, z1: Math.ceil(d / 2) + 1 }
}

export function buildBed(source: BlueprintSource): Blueprint {
  const { p, st, b, r, g } = setup(source)
  const [w, d] = BED[p.size]
  const x0 = -Math.floor((w - 1) / 2), x1 = x0 + w - 1, z0 = -Math.floor((d - 1) / 2), z1 = z0 + d - 1
  pad(b, g, rect(x0 - 1, z0 - 1, x1 + 1, z1 + 1))
  const soil = `minecraft:${SOIL[st.id] ?? 'dirt'}`
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      b.set(x, 1, z, soil)
      plant(b, x, 2, z, st.id, r, w * d >= 8 ? 0.3 : 0.15)
    }
  // Rahmen: Modern als Pflanzkübel aus glattem Stein, sonst Falltüren mit Pfosten an den Ecken
  for (let z = z0 - 1; z <= z1 + 1; z++)
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1
      if (inside) continue
      const corner = (x === x0 - 1 || x === x1 + 1) && (z === z0 - 1 || z === z1 + 1)
      if (st.id === 'modern') b.role(x, 1, z, 'trim')
      else if (corner) b.beam(x, 1, z, 'frame', 'y')
      else {
        const out = facingTo(x < x0 ? -1 : x > x1 ? 1 : 0, z < z0 ? -1 : z > z1 ? 1 : 0)
        sidePanel(b, x, 1, z, out, st.id === 'steampunk' ? 'minecraft:waxed_copper_trapdoor' : undefined)
      }
    }
  // Japan: Bambus in einer Ecke (wächst auf Moos)
  if (st.id === 'japan' && w >= 4) {
    b.clear(x1, 3, z0)
    for (let y = 2; y <= 4; y++) b.set(x1, y, z0, `minecraft:bamboo[age=0,leaves=${y === 4 ? 'large' : y === 3 ? 'small' : 'none'},stage=0]`)
  }
  return b.toBlueprint(`Beet (${st.label})`, source)
}

// ---------- Feuerstelle ----------

export function fireExtent(source: BlueprintSource): Extent {
  const rr = (source.params as { size: Size }).size === 'S' ? 3 : 4
  return { x0: -rr, z0: -rr, x1: rr, z1: rr }
}

export function buildFire(source: BlueprintSource): Blueprint {
  const { p, st, b, g } = setup(source)
  const R = p.size === 'S' ? 2 : 3
  const disk: Cell[] = []
  for (let z = -R - 1; z <= R + 1; z++) for (let x = -R - 1; x <= R + 1; x++) if (x * x + z * z <= (R + 1) * (R + 1)) disk.push([x, z])
  pad(b, g, disk)
  // Feuer in einer Mulde, ringsum ein niedriger Steinkranz
  b.role(0, 0, 0, 'sockel', {}, 1)
  b.set(0, 1, 0, 'minecraft:campfire[lit=true,signal_fire=false,facing=south]')
  for (const [x, z] of rect(-1, -1, 1, 1)) {
    if (!x && !z) continue
    b.role(x, 0, z, 'sockel', {}, 1)
    if (x && z) b.form(x, 1, z, 'sockel', 'slab', { type: 'bottom' })
  }
  // Sitze: S Treppen, ab M Baumstämme (3 lang), L dazu Holzstapel und Laternen
  const sides: [Facing, Cell][] = [['north', [0, -1]], ['south', [0, 1]], ['west', [-1, 0]], ['east', [1, 0]]]
  for (const [face, [dx, dz]] of sides) {
    if (p.size === 'S') {
      b.form(dx * R, 1, dz * R, 'detail', 'stairs', { facing: face, half: 'bottom' })
      continue
    }
    if (face === 'south' && p.size === 'L') continue // dort steht der Holzstapel
    const axis = dx ? 'z' : 'x'
    for (let k = -1; k <= 1; k++) b.beam(dx * R + (dx ? 0 : k), 1, dz * R + (dz ? 0 : k), 'frame', axis)
  }
  if (p.size === 'L') {
    for (let k = -1; k <= 1; k++) for (let y = 1; y <= 2; y++) b.beam(k, y, R + 1, 'frame', 'z')
    b.set(0, 1, R, 'minecraft:barrel[facing=up]')
    for (const [x, z] of [[-R, -R], [R, -R]] as Cell[]) {
      b.form(x, 1, z, 'detail', 'fence')
      b.set(x, 2, z, `${b.main('light')}[hanging=false]`)
    }
  }
  return b.toBlueprint(`Feuerstelle (${st.label})`, source)
}

// ---------- Pavillon ----------

const PAV: Record<Size, number> = { S: 2, M: 3, L: 4 }

export function pavilionExtent(source: BlueprintSource): Extent {
  const h = PAV[(source.params as { size: Size }).size] + 3
  return { x0: -h, z0: -h, x1: h, z1: h }
}

export function buildPavilion(source: BlueprintSource): Blueprint {
  const { p, st, b, r, g } = setup(source)
  const h = PAV[p.size]
  // Boden: Kante aus Sockel, innen Dielen; Stufe vorne
  foundation(b, g, rect(-h, -h, h, h))
  for (const [x, z] of rect(-h, -h, h, h)) b.role(x, 0, z, Math.abs(x) === h || Math.abs(z) === h ? 'sockel' : 'floor', {}, 1)
  // Pfosten an den Ecken, groß auch in der Mitte der Seiten (nicht vorne)
  const posts: Cell[] = [[-h, -h], [h, -h], [-h, h], [h, h]]
  if (p.size === 'L') posts.push([0, -h], [-h, 0], [h, 0])
  for (const [x, z] of posts) for (let y = 1; y <= 3; y++) b.beam(x, y, z, 'frame', 'y')
  const flat = st.id === 'modern' || st.id === 'wueste'
  // Balkenkranz über den Pfosten
  if (st.id !== 'modern')
    for (const [x, z] of rect(-h, -h, h, h)) {
      if (Math.abs(x) !== h && Math.abs(z) !== h) continue
      const corner = Math.abs(x) === h && Math.abs(z) === h
      b.beam(x, 4, z, 'frame', corner ? 'y' : Math.abs(z) === h ? 'x' : 'z')
    }
  let lanternTop = 4
  if (st.id === 'modern') {
    // dünnes Flachdach, Unterseite voll: daran hängt die Laterne
    for (const [x, z] of rect(-h - 1, -h - 1, h + 1, h + 1)) b.form(x, 4, z, 'trim', 'slab', { type: 'bottom' })
  } else if (st.id === 'wueste') {
    // Sonnensegel in Streifen über dem Balkenkranz
    const acc = b.palette!.roles.accent.map(a => a.id)
    for (const [x, z] of rect(-h, -h, h, h)) if (Math.abs(x) < h && Math.abs(z) < h) b.set(x, 4, z, `minecraft:${acc[(x + h) % acc.length]}`)
    for (const [x, z] of rect(-h - 1, -h - 1, h + 1, h + 1)) if (Math.abs(x) === h + 1 || Math.abs(z) === h + 1) b.form(x, 4, z, 'trim', 'slab', { type: 'bottom' })
    for (const [x, z] of rect(-h, -h, h, h)) if ((Math.abs(x) === h || Math.abs(z) === h) && (x + z) % 2 === 0) b.form(x, 5, z, 'trim', 'slab', { type: 'bottom' })
  } else if (st.id === 'japan') {
    // flache, geschwungene Traufe aus Stufen, dann steiler, aufgebogene Ecken
    const E = h + 2
    for (let a = E; a >= 0; a--) {
      const y = a >= h + 1 ? 4 : 4 + (h + 1 - a)
      for (const [x, z] of rect(-a, -a, a, a)) {
        if (Math.abs(x) !== a && Math.abs(z) !== a) continue
        if (a === 0) b.form(x, y, z, 'trim', 'slab', { type: 'bottom' })
        else if (a === E) b.form(x, y, z, 'trim', 'slab', { type: Math.abs(x) === a && Math.abs(z) === a ? 'top' : 'bottom' })
        else if (a === h + 1) b.form(x, y, z, 'roof', 'slab', { type: 'top' })
        else b.form(x, y, z, 'roof', 'stairs', { facing: facingTo(-x, -z), half: 'bottom' })
      }
    }
    lanternTop = 4 + h + 1
  } else {
    // Walmdach aus Treppen mit Überstand 1, Spitze als Stufe
    for (let a = h + 1; a >= 0; a--) {
      const y = 4 + (h + 1 - a)
      for (const [x, z] of rect(-a, -a, a, a)) {
        if (Math.abs(x) !== a && Math.abs(z) !== a) continue
        if (a === 0) b.form(x, y, z, 'trim', 'slab', { type: 'bottom' })
        else b.form(x, y, z, a === h + 1 ? 'trim' : 'roof', 'stairs', { facing: facingTo(-x, -z), half: 'bottom' })
      }
    }
    lanternTop = 4 + h + 1
    if (st.id === 'steampunk') b.set(0, lanternTop + 1, 0, 'minecraft:lightning_rod[facing=up]')
  }
  // Laterne in der Mitte: an einer Kette von der Spitze, bei Flachdach direkt darunter
  if (flat) b.set(0, 3, 0, `${b.main('light')}[hanging=true]`)
  else {
    for (let y = 4; y < lanternTop; y++) b.set(0, y, 0, `${chainId(st.id)}[axis=y]`)
    b.set(0, 3, 0, `${b.main('light')}[hanging=true]`)
  }
  // Bänke an der Rückseite (und groß an den Seiten), Blick zur Mitte
  for (let x = -h + 1; x <= h - 1; x++) b.form(x, 1, -h + 1, 'detail', 'stairs', { facing: 'north', half: 'bottom' })
  if (p.size === 'L')
    for (let z = -h + 2; z <= h - 1; z++) {
      if (z === 0) continue
      b.form(-h + 1, 1, z, 'detail', 'stairs', { facing: 'west', half: 'bottom' })
      b.form(h - 1, 1, z, 'detail', 'stairs', { facing: 'east', half: 'bottom' })
    }
  // Töpfe an den vorderen Pfosten
  if (p.size !== 'S') {
    pot(b, -h + 1, 1, h - 1, st.id, r)
    pot(b, h - 1, 1, h - 1, st.id, r)
  }
  b.form(0, 0, h + 1, 'sockel', 'stairs', { facing: 'north', half: 'bottom' })
  foundation(b, g, [[0, h + 1]])
  return b.toBlueprint(`Pavillon (${st.label})`, source)
}

// ---------- Lager ----------

export function storeExtent(): Extent {
  return { x0: -4, z0: -3, x1: 4, z1: 3 }
}

export function buildStore(source: BlueprintSource): Blueprint {
  const { p, st, b, r, g } = setup(source)
  const w = p.size === 'S' ? 1 : p.size === 'M' ? 2 : 3
  pad(b, g, rect(-w - 1, -2, w + 1, p.size === 'L' ? 2 : 1))
  // hinten: Holzstapel (Stammenden nach vorn), Fässer, Heu
  for (let x = -w; x <= (w > 1 ? -w + 1 : -w); x++) for (let y = 1; y <= (p.size === 'S' ? 1 : 2); y++) b.beam(x, y, -1, 'frame', 'z')
  b.set(0, 1, -1, 'minecraft:barrel[facing=north]')
  if (w === 3) b.set(-1, 1, -1, 'minecraft:barrel[facing=up]')
  if (p.size !== 'S') b.set(0, 2, -1, 'minecraft:barrel[facing=up]')
  b.set(w, 1, -1, 'minecraft:hay_block[axis=y]')
  if (p.size !== 'S') {
    b.set(w, 2, -1, 'minecraft:hay_block[axis=x]')
    b.set(w - 1, 1, -1, 'minecraft:hay_block[axis=z]')
  }
  // vorne: Komposter, Fass mit Topf, Wüste: Krüge, Steampunk: Kupferkiste und Kessel
  b.set(-w, 1, 0, 'minecraft:composter[level=6]')
  if (st.id === 'wueste') {
    // Krüge: Blumentöpfe auf Terrakotta (der verzierte Krug zeigt sich in der Vorschau nicht)
    b.set(w, 1, 0, 'minecraft:terracotta')
    pot(b, w, 2, 0, st.id, r)
    b.set(w - 1, 1, 0, 'minecraft:orange_terracotta')
  } else if (st.id === 'steampunk') {
    b.set(w, 1, 0, 'minecraft:cauldron')
    b.set(w - 1, 1, 0, 'minecraft:waxed_copper_bulb[lit=true]')
  } else {
    b.set(w, 1, 0, 'minecraft:barrel[facing=up]')
    pot(b, w, 2, 0, st.id, r)
  }
  // groß: Pultdach auf Pfosten
  if (p.size === 'L') {
    for (const x of [-w - 1, w + 1]) {
      for (let y = 1; y <= 3; y++) b.form(x, y, -1, 'detail', 'fence')
      for (let y = 1; y <= 2; y++) b.form(x, y, 1, 'detail', 'fence')
    }
    for (let x = -w - 1; x <= w + 1; x++) {
      b.form(x, 4, -2, 'roof', 'stairs', { facing: 'north', half: 'bottom' })
      b.form(x, 4, -1, 'roof', 'slab', { type: 'bottom' })
      b.form(x, 3, 0, 'roof', 'stairs', { facing: 'north', half: 'bottom' })
      b.form(x, 3, 1, 'roof', 'stairs', { facing: 'north', half: 'bottom' })
    }
    b.set(0, 2, 1, `${b.main('light')}[hanging=true]`)
    if (st.id === 'steampunk') b.set(w + 1, 5, -1, 'minecraft:lightning_rod[facing=up]')
  }
  return b.toBlueprint(`Lager (${st.label})`, source)
}

// ---------- Laternenpfahl ----------

export function buildPost(source: BlueprintSource): Blueprint {
  const { p, st, b } = setup(source)
  const h = ({ S: 3, M: 4, L: 5 } as Record<Size, number>)[p.size]
  const light = b.main('light')
  if (st.id === 'japan') {
    // Steinlaterne (Tōrō): breiter Fuß, Säule, Lichtkammer, Dach, Knauf
    const wall = wallId(b.main('sockel'))
    b.role(0, 0, 0, 'sockel', {}, 0)
    for (const f of ['north', 'south', 'east', 'west'] as Facing[]) b.form(OUT[f][0], 0, OUT[f][1], 'sockel', 'stairs', { facing: OUT_OPP[f], half: 'bottom' })
    for (let y = 1; y < h - 1; y++) b.set(0, y, 0, wall)
    b.form(0, h - 1, 0, 'sockel', 'slab', { type: 'top' })
    b.set(0, h, 0, `${light}[hanging=false]`)
    for (const [x, z] of rect(-1, -1, 1, 1)) b.form(x, h + 1, z, 'trim', x || z ? 'stairs' : 'slab', x || z ? { facing: facingTo(-x, -z), half: 'bottom' } : { type: 'bottom' })
    b.form(0, h + 2, 0, 'trim', 'slab', { type: 'bottom' })
    return b.toBlueprint('Steinlaterne', source)
  }
  // Sockel aus Stein, Pfosten, Querarm mit hängender Laterne (groß: zwei Arme)
  b.role(0, 0, 0, 'sockel', {}, 0)
  b.set(0, 1, 0, wallId(b.main('sockel')))
  const steam = st.id === 'steampunk'
  for (let y = 2; y <= h; y++) {
    if (st.id === 'modern') b.set(0, y, 0, wallId(b.main('frame')))
    else b.form(0, y, 0, 'detail', 'fence')
  }
  if (steam) b.set(0, 2, 0, 'minecraft:waxed_copper_bulb[lit=true]')
  const arms: number[] = p.size === 'L' ? [-1, 1] : [1]
  for (const dx of arms) {
    if (st.id === 'modern') b.form(dx, h, 0, 'trim', 'slab', { type: 'top' })
    else b.form(dx, h, 0, 'detail', 'fence')
    if (st.id === 'modern') {
      b.set(dx, h - 1, 0, `${chainId(st.id)}[axis=y]`)
      b.set(dx, h - 2, 0, `${light}[hanging=true]`)
    } else b.set(dx, h - 1, 0, `${light}[hanging=true]`)
  }
  if (st.id === 'modern') b.form(0, h + 1, 0, 'trim', 'slab', { type: 'bottom' })
  else if (steam) b.set(0, h + 1, 0, 'minecraft:lightning_rod[facing=up]')
  else if (st.id === 'wueste') b.form(0, h + 1, 0, 'trim', 'slab', { type: 'bottom' })
  else b.form(0, h + 1, 0, 'detail', 'trapdoor', { facing: 'north', half: 'bottom', open: 'false' })
  return b.toBlueprint(`Laternenpfahl (${st.label})`, source)
}

const OUT_OPP: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' }

// ---------- Torbogen ----------

export function archExtent(source: BlueprintSource): Extent {
  const hw = ({ S: 2, M: 2, L: 3 } as Record<Size, number>)[(source.params as { size: Size }).size] + 2
  return { x0: -hw, z0: -2, x1: hw, z1: 2 }
}

export function buildArch(source: BlueprintSource): Blueprint {
  const { p, st, b, g } = setup(source)
  const hw = ({ S: 2, M: 2, L: 3 } as Record<Size, number>)[p.size]
  const H = ({ S: 3, M: 4, L: 5 } as Record<Size, number>)[p.size]
  pad(b, g, rect(-hw - 1, -1, hw + 1, 1))
  for (let x = -hw + 1; x <= hw - 1; x++) b.role(x, 0, 0, 'path')
  if (st.id === 'japan') {
    // Torii: zwei Pfosten, Querbalken (Nuki), oberer Balken (Kasagi) mit hochgezogenen Enden
    for (const x of [-hw, hw]) {
      b.role(x, 0, 0, 'sockel', {}, 0)
      for (let y = 1; y <= H; y++) b.beam(x, y, 0, 'frame', 'y')
    }
    for (let x = -hw; x <= hw; x++) if (Math.abs(x) < hw) b.beam(x, H - 1, 0, 'frame', 'x')
    for (let x = -hw - 1; x <= hw + 1; x++) b.beam(x, H + 1, 0, 'frame', 'x')
    for (let x = -hw - 1; x <= hw + 1; x++) b.form(x, H + 2, 0, 'trim', 'slab', { type: 'bottom' })
    b.form(-hw - 2, H + 2, 0, 'trim', 'stairs', { facing: 'east', half: 'bottom' })
    b.form(hw + 2, H + 2, 0, 'trim', 'stairs', { facing: 'west', half: 'bottom' })
    return b.toBlueprint('Torii', source)
  }
  // Pfeiler aus Sockelstein, Bogen aus umgedrehten Treppen, Sturz, kleines Satteldach
  for (const x of [-hw, hw]) for (let y = 0; y <= H; y++) b.role(x, y, 0, y === 0 ? 'sockel' : st.id === 'modern' ? 'wall' : 'sockel', {}, 1)
  b.form(-hw + 1, H, 0, 'sockel', 'stairs', { facing: 'west', half: 'top' })
  b.form(hw - 1, H, 0, 'sockel', 'stairs', { facing: 'east', half: 'top' })
  for (let x = -hw; x <= hw; x++) b.role(x, H + 1, 0, st.id === 'modern' ? 'wall' : 'sockel', {}, 0)
  if (st.id === 'modern') {
    for (let x = -hw - 1; x <= hw + 1; x++) for (let z = -1; z <= 1; z++) b.form(x, H + 2, z, 'trim', 'slab', { type: 'bottom' })
  } else if (st.id === 'wueste') {
    for (let x = -hw; x <= hw; x++) if ((x + hw) % 2 === 0) b.form(x, H + 2, 0, 'trim', 'slab', { type: 'bottom' })
  } else {
    for (let x = -hw - 1; x <= hw + 1; x++) {
      b.form(x, H + 1, -1, 'roof', 'stairs', { facing: 'south', half: 'bottom' })
      b.form(x, H + 1, 1, 'roof', 'stairs', { facing: 'north', half: 'bottom' })
      b.form(x, H + 2, 0, 'trim', 'slab', { type: 'bottom' })
    }
  }
  b.set(0, H, 0, `${b.main('light')}[hanging=true]`)
  return b.toBlueprint(`Torbogen (${st.label})`, source)
}

// ---------- Liste für den Katalog ----------

export interface DekoEntry {
  id: string
  label: string
  build: (source: BlueprintSource) => Blueprint
  ground?: (source: BlueprintSource) => Extent | null
  /** Varianten über den Seed (Pflanzen, Blumen) */
  seeded: boolean
  /** S/M/L ändert etwas */
  sized: boolean
}

export const DEKO: DekoEntry[] = [
  { id: 'bank', label: 'Bank', build: buildBench, ground: benchExtent, seeded: true, sized: true },
  { id: 'garten', label: 'Gemüsegarten', build: buildGarden, ground: gardenExtent, seeded: true, sized: true },
  { id: 'beet', label: 'Beet', build: buildBed, ground: bedExtent, seeded: true, sized: true },
  { id: 'feuer', label: 'Feuerstelle', build: buildFire, ground: fireExtent, seeded: false, sized: true },
  { id: 'pavillon', label: 'Pavillon', build: buildPavilion, ground: pavilionExtent, seeded: true, sized: true },
  { id: 'lager', label: 'Lager', build: buildStore, ground: storeExtent, seeded: true, sized: true },
  { id: 'pfahl', label: 'Laternenpfahl', build: buildPost, seeded: false, sized: true },
  { id: 'bogen', label: 'Torbogen', build: buildArch, ground: archExtent, seeded: false, sized: true },
]
