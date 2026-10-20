// Klickpfad für ui-pruefung: Testwelt, Bereich aufziehen und benennen, in 3D öffnen, Testhaus setzen, Schichten.
export default async (page, foto) => {
  const base = page.url().split('?')[0]
  await page.goto(`${base}?demo`)
  await page.waitForSelector('.world-name', { timeout: 10000 })
  await page.waitForTimeout(1200)
  await foto('karte')
  await page.click('.map-draw')
  const box = await page.locator('#map canvas').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx - 50, cy - 40)
  await page.mouse.down()
  await page.mouse.move(cx + 60, cy + 60, { steps: 6 })
  await page.mouse.up()
  await page.waitForSelector('[data-rename-area]')
  await page.fill('[data-rename-area]', 'Hang am See')
  await page.keyboard.press('Enter')
  await foto('bereich')
  await page.click('[data-act="open-area"]')
  await page.waitForSelector('.progress', { state: 'hidden', timeout: 30000 })
  await foto('3d')
  await page.click('[data-act="start-place"]')
  // zielen wie ein Mensch: dorthin, wo die Anzeige einen Block nennt
  await page.waitForTimeout(600)
  const c = await page.locator('#three canvas').boundingBox()
  let at = null
  for (let fy = 0.55; fy < 0.95 && !at; fy += 0.05)
    for (let fx = 0.3; fx < 0.75 && !at; fx += 0.1) {
      await page.mouse.move(c.x + c.width * fx, c.y + c.height * fy)
      await page.waitForTimeout(80)
      if (/Block|grass|leaves|sand|log/.test((await page.locator('#readout').textContent()) ?? '')) at = [c.x + c.width * fx, c.y + c.height * fy]
    }
  await page.mouse.click(...(at ?? [c.x + c.width / 2, c.y + c.height * 0.7]))
  await page.waitForSelector('#guide:not([hidden])', { timeout: 5000 })
  await foto('platziert')
  await page.click('[data-g="next"]')
  await page.click('[data-g="next"]')
  await page.waitForTimeout(400)
  await foto('ebene')
}
