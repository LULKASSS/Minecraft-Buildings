// Echte Blockmodelle und Texturen aus der Minecraft-.jar (oder einem Ressourcenpaket) über deepslate.
// Die App liefert keine Texturen mit, sie liest sie zur Laufzeit aus der Datei, die der Nutzer wählt.

import type * as THREE from 'three'
import type { BlockState } from '../blueprint/blockstate'
import type { MeshData, VoxelBlock } from './mesher'

export interface TexturedMesher {
  texture: THREE.Texture
  mesh(blocks: VoxelBlock[], occludes: (x: number, y: number, z: number, self: BlockState) => boolean, keepTop: boolean): MeshData
}
