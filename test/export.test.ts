import { LitematicLoader } from '@mattzh72/lodestone'
import { NbtFile } from 'deepslate'
import { describe, expect, it } from 'vitest'
import { canonical } from '../src/blueprint/blockstate'
import { transformBlueprint } from '../src/blueprint/transform'
import { testHouse } from '../src/catalog/decorative/test-house'
import { bitsFor, packLitematica, unpackLitematica, writeLitematic } from '../src/export/litematic'
import { readVarints, writeSchem } from '../src/export/schem'

describe('Litematica-Bitpacking', () => {
  it('packt über Long-Grenzen und zurück', () => {
    for (const bits of [2, 3, 5, 7, 13]) {
      const n = 1000
      const values = Array.from({ length: n }, (_, i) => (i * 7919) % (1 << bits))
      const packed = packLitematica(values, bits)
      expect(packed.length).toBe(Math.ceil((n * bits) / 64))
      expect(Array.from(unpackLitematica(packed, bits, n))).toEqual(values)
    }
  })
  it('nimmt mindestens 2 Bit', () => {
    expect(bitsFor(1)).toBe(2)
    expect(bitsFor(2)).toBe(2)
    expect(bitsFor(5)).toBe(3)
    expect(bitsFor(16)).toBe(4)
    expect(bitsFor(17)).toBe(5)
  })
})

describe('Export', () => {
  const house = transformBlueprint(testHouse(), 90)

  it('.litematic hat die erwarteten Kopfdaten', () => {
    const bytes = writeLitematic(house, { name: 'Testhaus', dataVersion: 4786, now: 0 })
    const root = NbtFile.read(bytes).root
    expect(root.getNumber('Version')).toBe(7)
    expect(root.getNumber('SubVersion')).toBe(1)
    expect(root.getNumber('MinecraftDataVersion')).toBe(4786)
    const meta = root.getCompound('Metadata')
    expect(meta.getNumber('TotalBlocks')).toBe(house.count())
    const size = root.getCompound('Regions').getCompound('Testhaus').getCompound('Size')
    expect([size.getNumber('x'), size.getNumber('y'), size.getNumber('z')]).toEqual(house.size)
  })

  it('.litematic wird von einem fremden Leser (Lodestone) gleich gelesen', () => {
    const bytes = writeLitematic(house, { name: 'Testhaus', dataVersion: 4786 })
    const s = LitematicLoader.load(bytes)
    const read = new Map<string, string>()
    for (const b of s.getBlocks()) {
      const name = b.state.getName().toString()
      if (name === 'minecraft:air') continue
      const props = b.state.getProperties()
      const st = Object.keys(props).length ? `${name}[${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',')}]` : name
      read.set(b.pos.join(','), canonical(st))
    }
    const expected = new Map(house.list().map(b => [`${b.x},${b.y},${b.z}`, b.state]))
    expect(read).toEqual(expected)
  })

  it('.schem (Sponge v3) enthält Palette und alle Blöcke', () => {
    const bytes = writeSchem(house, { name: 'Testhaus', dataVersion: 4786 })
    const s = NbtFile.read(bytes).root.getCompound('Schematic')
    expect(s.getNumber('Version')).toBe(3)
    expect([s.getNumber('Width'), s.getNumber('Height'), s.getNumber('Length')]).toEqual(house.size)
    const blocks = s.getCompound('Blocks')
    const pal = new Map<number, string>()
    blocks.getCompound('Palette').forEach((k, v) => pal.set(v.getAsNumber(), k))
    const data = readVarints(blocks.getByteArray('Data').getItems().map(b => b.getAsNumber()), house.blocks.length)
    let i = 0
    for (let y = 0; y < house.size[1]; y++)
      for (let z = 0; z < house.size[2]; z++)
        for (let x = 0; x < house.size[0]; x++, i++) expect(pal.get(data[i])).toBe(house.get(x, y, z))
  })
})
