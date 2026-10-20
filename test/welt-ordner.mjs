// Schreibt Testwelten als echten Ordner auf die Platte (für den Rundgang mit Ordnerauswahl).
// Aufruf: node --experimental-strip-types test/welt-ordner.mjs <zielordner> [chunks je Seite, Standard 8]
//         node --experimental-strip-types test/welt-ordner.mjs <minecraft-ordner> minecraft [jar]
//           → Minecraft-Ordner mit saves/ (kleine und große Testwelt) und versions/26.1 (mit .jar, falls angegeben)
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeBigWorld, makeLevelDat, makeWorld } from '../src/world/demo-world.ts'

const ziel = process.argv[2] ?? 'test/out/Realm Testwelt'
const schreib = (root, files) => {
  for (const [p, data] of files) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), data)
  }
}
if (process.argv[3] === 'minecraft') {
  const klein = makeWorld()
  klein.set('level.dat', makeLevelDat('Realm Testwelt', 4786, 1760800000000))
  schreib(join(ziel, 'saves', 'Realm Testwelt'), klein)
  schreib(join(ziel, 'saves', 'Grosse Welt'), makeBigWorld(2, 'Große Testwelt'))
  mkdirSync(join(ziel, 'versions', '26.1'), { recursive: true })
  writeFileSync(join(ziel, 'versions', '26.1', '26.1.json'), JSON.stringify({ id: '26.1' }))
  if (process.argv[4]) copyFileSync(process.argv[4], join(ziel, 'versions', '26.1', '26.1.jar'))
  mkdirSync(join(ziel, 'versions', 'fabric-loader-0.17-26.1'), { recursive: true })
  writeFileSync(join(ziel, 'versions', 'fabric-loader-0.17-26.1', 'fabric-loader-0.17-26.1.jar'), 'kein echtes jar')
} else schreib(ziel, makeWorld(Number(process.argv[3] ?? 8)))
console.log(ziel)
