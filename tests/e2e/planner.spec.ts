import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const fallbackPlans = JSON.parse(
  readFileSync(new URL('../../src/server/fallback-plans.json', import.meta.url), 'utf8'),
) as unknown[]

test('curated expedition hero flow reaches a usable plan', async ({ page }) => {
  await page.route('**/api/plan', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fallbackPlans[0]),
    }),
  )
  await page.goto('/planner?example=sf-santa-cruz')
  await expect(page.getByRole('heading', { name: /Plan the ride/i })).toBeVisible()
  await page.getByRole('button', { name: /Generate expedition/i }).click()
  await expect(page.locator('.results-shell')).toBeVisible({ timeout: 75_000 })
  await expect(page.getByText('DAILY STAGES')).toBeVisible()
  await expect(page.locator('.stage-card').first()).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export GPX/i }).click()
  expect((await downloadPromise).suggestedFilename()).toMatch(/bikepacking\.gpx$/)
  await expect(page.getByText(/TOTAL DISTANCE/)).toBeVisible()
  await page.reload()
  await expect(page.locator('.results-shell')).toBeVisible()
  await expect(page.getByText(/TOTAL DISTANCE/)).toBeVisible()
})

test('WebMCP registry exposes four structured tools without UI scraping', async ({ page }) => {
  await page.addInitScript(() => {
    const registered: Array<{ name: string; execute: (input: unknown) => Promise<unknown> }> = []
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool: (tool: (typeof registered)[number]) => registered.push(tool) },
    })
    Object.defineProperty(window, '__registeredWebMcpTools', { value: registered, writable: false })
  })
  await page.goto('/planner')
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as typeof window & { __registeredWebMcpTools?: Array<{ name: string }> }
        ).__registeredWebMcpTools?.map((tool) => tool.name),
      ),
    )
    .toEqual([
      'search_locations',
      'set_trip_parameters',
      'generate_expedition_plan',
      'get_expedition_plan',
    ])
  const result = await page.evaluate(async () => {
    const tools = (
      window as typeof window & {
        __registeredWebMcpTools: Array<{
          name: string
          execute: (input: unknown) => Promise<unknown>
        }>
      }
    ).__registeredWebMcpTools
    return tools.find((tool) => tool.name === 'get_expedition_plan')?.execute({})
  })
  expect(result).toEqual({
    status: 'error',
    error: { code: 'PLAN_NOT_READY', message: 'Generate an expedition plan before inspecting it.' },
  })
})
