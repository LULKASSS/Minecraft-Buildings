// Rundgang durch die App im echten Browser: Testwelt laden, Punkt setzen, Testhaus bauen,
// 3D öffnen, Schichten durchgehen, exportieren. Bilder landen in test/out/.
// Aufruf: npm run build && npm run test:e2e
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const OUT = new URL('./out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const PORT = 4179
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 1500))

const executablePath = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errors = []
const fail = msg => { errors.push(msg); console.error('✗', msg) }

async function run(theme, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, acceptDownloads: true })
  page.on('pageerror', e => fail(`${theme} ${width}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') fail(`${theme} ${width} console: ${m.text()}`) })
  const shot = name => page.screenshot({ path: `${OUT}${name}-${theme}-${width}.png` })

  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForTimeout(400)
  await shot('01-start')
  await page.goto(`http://localhost:${PORT}/?demo`)
  await page.waitForSelector('.world-name', { timeout: 8000 })
  await page.waitForTimeout(1500)
  await shot('02-karte')

  // Optional: Texturen aus einer echten Minecraft-.jar (JAR=/pfad/zur/26.1.jar)
  if (process.env.JAR && width === 1440) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="textures"]')])
    await chooser.setFiles(process.env.JAR)
    await page.waitForFunction(() => document.body.textContent.includes('Texturen aus deiner .jar'), null, { timeout: 60000 })
    await page.waitForTimeout(1500)
    await shot('02b-karte-texturen')
  }

  // Punkt mitten auf die Karte setzen
  const box = await page.locator('#map canvas').boundingBox()
  await page.mouse.click(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20)
  await page.waitForSelector('[data-act="place"]', { timeout: 5000 })
  await shot('03-punkt')
  await page.click('[data-act="place"]')
  await page.waitForSelector('#guide:not([hidden])')
  await page.waitForTimeout(300)
  await shot('04-platziert')

  await page.click('[data-act="open3d"]')
  await page.waitForTimeout(2500)
  await shot('05-3d')
  await page.click('[data-g="next"]')
  await page.click('[data-g="next"]')
  await page.waitForTimeout(500)
  await shot('06-ebene2')
  await page.click('[data-g="single"]')
  await page.waitForTimeout(400)
  await shot('07-nur-ebene')
  await page.click('[data-act="rotR"]')
  await page.waitForTimeout(800)
  await shot('08-gedreht')

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="litematic"]')])
  const path = `${OUT}export-${theme}.litematic`
  await dl.saveAs(path)

  // Neu laden: Markierung und Bauwerk müssen noch da sein
  await page.goto(`http://localhost:${PORT}/?demo`)
  await page.waitForSelector('.world-name')
  await page.waitForTimeout(800)
  const markers = await page.locator('[data-marker]').count()
  if (theme === 'light' && markers < 1) fail('Markierung nach Neuladen weg (Testwelt speichert bewusst? prüfen)')
  await page.close()
}

// Wie im Claude-Artifact: App in einer fremden Seite eingebettet. Dort gibt es keinen showDirectoryPicker,
// der Weltordner kommt über die Dateiauswahl.
async function eingebettet() {
  const { execFileSync } = await import('node:child_process')
  const dir = execFileSync(process.execPath, ['--experimental-strip-types', new URL('./welt-ordner.mjs', import.meta.url).pathname, `${OUT}Realm Testwelt`]).toString().trim()
  const { createServer } = await import('node:http')
  const host = createServer((_, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><body style="margin:0"><iframe src="http://localhost:${PORT}/" style="border:0;width:100vw;height:100vh"></iframe>`)
  }).listen(PORT + 1)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => fail(`eingebettet: ${e.message}`))
  await page.goto(`http://127.0.0.1:${PORT + 1}/`)
  const frame = page.frameLocator('iframe')
  await frame.locator('[data-act="upload"]').waitFor({ timeout: 8000 })
  if (await frame.locator('[data-act="folder"]').count()) fail('eingebettet: Knopf "verbinden" sichtbar, der dort nicht geht')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), frame.locator('[data-act="upload"]').click()])
  await chooser.setFiles(dir)
  await frame.locator('.world-name').waitFor({ timeout: 10000 })
  const name = await frame.locator('.world-name').textContent()
  if (name !== 'Testwelt') fail(`eingebettet: Welt heißt "${name}"`)
  await page.waitForTimeout(1200)
  if (process.env.JAR) {
    const [jc] = await Promise.all([page.waitForEvent('filechooser'), frame.locator('[data-act="textures"]').click()])
    await jc.setFiles(process.env.JAR)
    await frame.getByText('Texturen aus deiner .jar').waitFor({ timeout: 60000 })
    await page.waitForTimeout(1500)
  }
  const box = await frame.locator('#map canvas').boundingBox()
  await page.mouse.click(box.x + box.width / 2 + 24, box.y + box.height / 2 + 10)
  await frame.locator('[data-act="place"]').click()
  await frame.locator('[data-act="open3d"]').click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}09-eingebettet-ordner.png` })
  await page.close()
  host.close()
}

try {
  await eingebettet()
  await run('light', 1440, 900)
  await run('dark', 1440, 900)
  await run('light', 1024, 700)
} catch (e) {
  fail(String(e))
} finally {
  await browser.close()
  server.kill()
}
if (errors.length) { console.error(`${errors.length} Fehler`); process.exit(1) }
console.log('Rundgang ok, Bilder in test/out/')
