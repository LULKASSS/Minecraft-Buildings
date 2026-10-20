// Kleine Vorschaubilder für Varianten: ein eigener, kleiner Renderer, Blick schräg von vorn.

import * as THREE from 'three'
import type { Blueprint } from '../blueprint/blueprint'
import { meshFallback } from './mesher'
import { isOpaqueCube } from './shapes'
import type { TexturedMesher } from './textured'

const W = 240, H = 180
let renderer: THREE.WebGLRenderer | null = null

export function thumbnail(bp: Blueprint, textured: TexturedMesher | null, background: string): string {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
    renderer.setSize(W, H, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }
  const solid = new Set<string>()
  const list = bp.list()
  for (const b of list) if (isOpaqueCube(b.state)) solid.add(`${b.x},${b.y},${b.z}`)
  const occ = (x: number, y: number, z: number) => solid.has(`${x},${y},${z}`)
  const data = textured ? textured.mesh(list, occ, false) : meshFallback(list, { occludes: occ })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
  if (data.uvs) g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(data.indices, 1))
  const mat = textured
    ? new THREE.MeshBasicMaterial({ map: textured.texture, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ vertexColors: true })
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(background)
  scene.add(new THREE.Mesh(g, mat))
  const [w, h, d] = bp.size
  const c = new THREE.Vector3(w / 2, h * 0.42, d / 2)
  const r = Math.max(w, h * 1.1, d)
  const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 1000)
  cam.position.set(c.x + r * 1.05, c.y + r * 0.75, c.z + r * 1.35)
  cam.lookAt(c)
  renderer.render(scene, cam)
  const url = renderer.domElement.toDataURL('image/png')
  g.dispose()
  mat.dispose()
  return url
}
