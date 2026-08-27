import { expect, test } from '@playwright/test'

test('landing stays within Sport responsive layout constraints', async ({ page }) => {
  for (const width of [320, 375, 414, 768, 1280, 1920]) {
    const height = width === 1280 ? 800 : 900
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByRole('heading', { name: /Two places in/i })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1)

    const wrappedAffordances = await page
      .locator('a:visible, button:visible')
      .evaluateAll((items) =>
        items.flatMap((item) => {
          const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
          const rects: DOMRect[] = []
          let node = walker.nextNode()
          while (node) {
            const range = document.createRange()
            range.selectNodeContents(node)
            rects.push(
              ...[...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0),
            )
            node = walker.nextNode()
          }

          const lineBands: Array<{ top: number; bottom: number }> = []
          for (const rect of rects.sort((left, right) => left.top - right.top)) {
            const band = lineBands.find(
              (line) => rect.top < line.bottom - 1 && rect.bottom > line.top + 1,
            )
            if (band) {
              band.top = Math.min(band.top, rect.top)
              band.bottom = Math.max(band.bottom, rect.bottom)
            } else {
              lineBands.push({ top: rect.top, bottom: rect.bottom })
            }
          }
          return lineBands.length > 1 ? [item.textContent?.trim() ?? item.tagName] : []
        }),
      )
    expect(wrappedAffordances, `wrapped affordance at ${width}px`).toEqual([])
  }
})

test('keeps landing slab copy inside its horizontal padding', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const insets = await page.evaluate(() => {
    const measure = (slabSelector: string, contentSelector: string) => {
      const slab = document.querySelector<HTMLElement>(slabSelector)
      const content = document.querySelector<HTMLElement>(contentSelector)
      if (!slab || !content) throw new Error(`Missing landing element: ${slabSelector}`)
      const slabRect = slab.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      return {
        paddingLeft: Number.parseFloat(getComputedStyle(slab).paddingLeft),
        contentInset: contentRect.left - slabRect.left,
      }
    }

    return {
      proof: measure('.landing-proof', '.proof-intro'),
      footer: measure('.landing-footer', '.landing-footer-statement'),
    }
  })

  expect(insets.proof.paddingLeft).toBeGreaterThanOrEqual(16)
  expect(insets.proof.contentInset).toBeGreaterThanOrEqual(16)
  expect(insets.footer.paddingLeft).toBeGreaterThanOrEqual(16)
  expect(insets.footer.contentInset).toBeGreaterThanOrEqual(16)
})

test('sample expedition CTA opens the planner with its curated route', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /Plan a sample expedition/i }).click()
  await expect(page).toHaveURL(/\/planner\?example=sf-santa-cruz/)
  await expect(page.getByRole('heading', { name: /Plan the ride/i })).toBeVisible()
})

test('landing example shows the validated SF route metrics', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.route-card-footer')).toContainText('~ 124')
  await expect(page.locator('.route-card-footer')).toContainText('1,937')
})
