import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const fallbackPlans = JSON.parse(
  readFileSync(new URL('../../src/server/fallback-plans.json', import.meta.url), 'utf8'),
) as Array<{ input: { start: { label: string } } }>

function fixture() {
  return structuredClone(fallbackPlans[0])
}

async function useFixture(
  page: Page,
  plan = fixture(),
  mutate?: (plan: { input: { start: { label: string } } }) => void,
) {
  mutate?.(plan)
  await page.route('**/api/plan', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(plan),
    }),
  )
}

test('renders untrusted map labels as literal text', async ({ page }) => {
  const maliciousLabel = `<img src=x onerror="document.body.dataset.tooltipXss='executed'"><iframe srcdoc="<script>document.body.dataset.tooltipFrame='executed'</script>"></iframe>`
  await useFixture(page, fixture(), (plan) => {
    plan.input.start.label = maliciousLabel
  })

  await page.goto('/planner?example=sf-santa-cruz')
  await page.getByRole('button', { name: /Generate expedition/i }).click()
  await expect(page.locator('.results-shell')).toBeVisible()
  await page.locator('.route-marker--start').dispatchEvent('click')

  const tooltip = page.locator('.leaflet-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveText(maliciousLabel)
  await expect(tooltip.locator('img, iframe, script')).toHaveCount(0)
  expect(await page.locator('body').getAttribute('data-tooltip-xss')).toBeNull()
  expect(await page.locator('body').getAttribute('data-tooltip-frame')).toBeNull()
})

test('fits the map to the selected stage', async ({ page }) => {
  await useFixture(page)
  await page.goto('/planner?example=sf-santa-cruz')
  await page.getByRole('button', { name: /Generate expedition/i }).click()
  await expect(page.locator('.results-shell')).toBeVisible()

  const mapState = () =>
    page.evaluate(() => [
      document.querySelector('.leaflet-map-pane')?.getAttribute('style'),
      document.querySelector('.leaflet-zoom-animated')?.getAttribute('style'),
    ])
  const before = await mapState()
  await page.getByRole('button', { name: /Day 01/i }).click()
  await expect.poll(mapState).not.toEqual(before)
})

test('exposes selected units and stage state programmatically', async ({ page }) => {
  await useFixture(page)
  await page.goto('/planner?example=sf-santa-cruz')
  await page.getByRole('button', { name: /Generate expedition/i }).click()
  await expect(page.locator('.results-shell')).toBeVisible()

  const metric = page.getByRole('button', { name: 'Metric', exact: true })
  const imperial = page.getByRole('button', { name: 'Imperial', exact: true })
  await expect(metric).toHaveAttribute('aria-pressed', 'true')
  await expect(imperial).toHaveAttribute('aria-pressed', 'false')

  await imperial.click()
  await expect(metric).toHaveAttribute('aria-pressed', 'false')
  await expect(imperial).toHaveAttribute('aria-pressed', 'true')

  const dayOne = page.getByRole('button', { name: /Day 01/i })
  await expect(dayOne).toHaveAttribute('aria-pressed', 'false')
  await dayOne.click()
  await expect(dayOne).toHaveAttribute('aria-pressed', 'true')
  await dayOne.click()
  await expect(dayOne).toHaveAttribute('aria-pressed', 'false')
})

test('contains the planner at a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await useFixture(page)
  await page.goto('/planner?example=sf-santa-cruz')
  await page.getByRole('button', { name: /Generate expedition/i }).click()
  await expect(page.locator('.results-shell')).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mapWidth: document.querySelector('.route-map')?.getBoundingClientRect().width,
    chartWidth: document.querySelector('.elevation-chart')?.getBoundingClientRect().width,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 1)
  expect(dimensions.mapWidth).toBeLessThanOrEqual(dimensions.innerWidth)
  expect(dimensions.chartWidth).toBeLessThanOrEqual(dimensions.innerWidth)
  await expect(
    page.getByRole('button', { name: /Regenerate expedition|Generate expedition/i }),
  ).toBeVisible()
  await expect(page.locator('.stage-card').first()).toBeVisible()
  await expect(page.locator('.elevation-chart canvas')).toBeVisible()
})
