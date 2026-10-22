// Klickpfad für ui-pruefung (Fassung 6): Testwelt direkt in 3D, Haus setzen, Anleitung, Flugmodus, große Karte.
export default async (page, foto) => {
  const base = page.url().split('?')[0]
  await page.goto(`${base}?demo`)
  await page.waitForSelector('#side:not([hidden])', { timeout: 10000 })
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 60000 })
  await page.waitForTimeout(800)
  await foto('3d')
  await page.click('[data-act="start-place"]')
  // zielen wie ein Mensch: dorthin, wo die Anzeige oben einen Block nennt
  const c = await page.locator('#three canvas').boundingBox()
  let at = null
  for (let fy = 0.45; fy < 0.9 && !at; fy += 0.05)
    for (let fx = 0.4; fx < 0.75 && !at; fx += 0.07) {
      await page.mouse.move(c.x + c.width * fx, c.y + c.height * fy)
      await page.waitForTimeout(60)
      if (/grass|leaves|sand|log|cobble/i.test((await page.locator('#status').textContent()) ?? '')) at = [c.x + c.width * fx, c.y + c.height * fy]
    }
  await page.mouse.click(...(at ?? [c.x + c.width / 2, c.y + c.height * 0.6]))
  await page.waitForSelector('#guide:not([hidden])', { timeout: 5000 })
  await foto('gesetzt')
  await page.click('[data-g="next"]')
  await page.click('[data-g="next"]')
  await page.waitForTimeout(400)
  await foto('ebene')
  await page.click('[data-g="close"]')
  await page.keyboard.press('f')
  await page.waitForTimeout(400)
  await foto('flug')
  await page.keyboard.press('f')
  await page.keyboard.press('m')
  await page.waitForTimeout(600)
  await foto('karte')
}
