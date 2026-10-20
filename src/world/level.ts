// level.dat lesen und herausfinden, wo die Regionen der Oberwelt liegen.
// Ab 26.1: dimensions/minecraft/overworld/region, davor: region/.

import { NbtFile, type NbtCompound } from 'deepslate/nbt'
import type { WorldSource } from './source'

export const REGION_DIRS = ['dimensions/minecraft/overworld/region', 'region']

export interface RegionRef {
  rx: number
  rz: number
  file: string
}

export interface WorldInfo {
  name: string
  dataVersion: number
  versionName: string
  spawn: [number, number, number] | null
  regionDir: string
  regions: RegionRef[]
}

export function parseLevel(bytes: Uint8Array): Omit<WorldInfo, 'regionDir' | 'regions'> {
  const root = NbtFile.read(bytes).root
  const data: NbtCompound = root.hasCompound('Data') ? root.getCompound('Data') : root
  const version = data.hasCompound('Version') ? data.getCompound('Version') : null
  return {
    name: data.getString('LevelName') || 'Welt',
    dataVersion: data.getNumber('DataVersion') || version?.getNumber('Id') || 0,
    versionName: version?.getString('Name') ?? '',
    spawn: readSpawn(data),
  }
}

function readSpawn(data: NbtCompound): [number, number, number] | null {
  // 1.21.9+: spawn { pos: [I; x, y, z] }, vorher SpawnX/Y/Z
  if (data.hasCompound('spawn')) {
    const pos = data.getCompound('spawn').getIntArray('pos').getItems().map(t => t.getAsNumber())
    if (pos.length === 3) return [pos[0], pos[1], pos[2]]
  }
  if (data.hasNumber('SpawnX')) return [data.getNumber('SpawnX'), data.getNumber('SpawnY'), data.getNumber('SpawnZ')]
  return null
}

export function parseRegionName(file: string): { rx: number; rz: number } | null {
  const m = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(file)
  return m ? { rx: Number(m[1]), rz: Number(m[2]) } : null
}

export async function openWorld(src: WorldSource): Promise<WorldInfo> {
  const level = await src.read('level.dat')
  if (!level) throw new Error('Keine level.dat gefunden. Bitte den Ordner der Welt wählen (den mit level.dat darin).')
  const info = parseLevel(new Uint8Array(await level.blob.arrayBuffer()))
  for (const dir of REGION_DIRS) {
    const files = await src.list(dir)
    const regions = files.flatMap(f => {
      const r = parseRegionName(f)
      return r ? [{ ...r, file: `${dir}/${f}` }] : []
    })
    if (regions.length) return { ...info, regionDir: dir, regions }
  }
  throw new Error('In der Welt liegen keine Region-Dateien (.mca). Wurde sie schon einmal gespielt?')
}
