// Vorschau aller Deko-Dinge und Brunnen für die Sichtprüfung (nur für Entwicklung, nicht Teil der App).
import * as THREE from 'three'
import type { Blueprint } from '../src/blueprint/blueprint'
import { DEKO } from '../src/catalog/deko'
import { buildWell } from '../src/catalog/small'
import { STYLES, type Size } from '../src/catalog/styles'
import { meshFallback } from '../src/render/mesher'
import { isOpaqueCube } from '../src/render/shapes'
import type { TexturedMesher } from '../src/render/textured'
import { loadTextures } from '../src/render/textures-loader'

const W = 420, H = 320
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H, false)
renderer.outputColorSpace = THREE.SRGBColorSpace

function shot(bp: Blueprint, tex: TexturedMesher | null): string {
  const solid = new Set<string>()
  const list = bp.list()
  for (const b of list) if (isOpaqueCube(b.state)) solid.add(`${b.x},${b.y},${b.z}`)
  const occ = (x: number, y: number, z: number) => solid.has(`${x},${y},${z}`)
  const data = tex ? tex.mesh(list, occ, false) : meshFallback(list, { occludes: occ })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
  if (data.uvs) g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(data.indices, 1))
  const mat = tex ? new THREE.MeshBasicMaterial({ map: tex.texture, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ vertexColors: true })
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#dfe3e8')
  scene.add(new THREE.Mesh(g, mat))
  const [w, h, d] = bp.size
  const c = new THREE.Vector3(w / 2, h * 0.4, d / 2)
  const r = Math.max(w, h * 1.1, d, 4)
  const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 1000)
  cam.position.set(c.x + r * 1.0, c.y + r * 0.8, c.z + r * 1.45)
  cam.lookAt(c)
  renderer.render(scene, cam)
  g.dispose()
  mat.dispose()
  return renderer.domElement.toDataURL('image/png')
}

function render(tex: TexturedMesher | null): void {
  const out = document.getElementById('out')!
  out.innerHTML = ''
  const which = new URLSearchParams(location.search).get('nur')
  const sizes = (new URLSearchParams(location.search).get('groesse') ?? 'M').split(',') as Size[]
  const items = [...DEKO.map(e => ({ id: e.id, label: e.label, build: e.build })), { id: 'brunnen', label: 'Brunnen', build: buildWell }]
  for (const e of items) {
    if (which && !which.split(',').includes(e.id)) continue
    const h = document.createElement('h2')
    h.textContent = e.label
    h.id = `h-${e.id}`
    out.appendChild(h)
    const row = document.createElement('div')
    row.className = 'row'
    row.id = `r-${e.id}`
    for (const st of STYLES)
      for (const size of sizes) {
        const bp = e.build({ generator: e.id, version: 1, seed: 7, params: { style: st.id, palette: st.palettes[0], size } })
        const f = document.createElement('figure')
        f.innerHTML = `<img src="${shot(bp, tex)}" width="${W}" height="${H}"><figcaption>${e.label} · ${st.label} · ${size}</figcaption>`
        row.appendChild(f)
      }
    out.appendChild(row)
  }
  ;(window as unknown as { fertig: boolean }).fertig = true
}

document.getElementById('jar')!.addEventListener('change', async ev => {
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (!f) return
  const t = await loadTextures(f)
  render(t.mesher)
})
if (!new URLSearchParams(location.search).has('jar')) render(null)
