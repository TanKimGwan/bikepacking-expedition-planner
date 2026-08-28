import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import type { ExpeditionPlan } from '../../shared/contracts/expedition'
import { ExpeditionInputSchema } from '../../shared/contracts/expedition'
import { buildExpeditionPlan, normalizeRoute } from '../../shared/domain/planning'

const fallbackPlans = JSON.parse(
  readFileSync(new URL('../../src/server/fallback-plans.json', import.meta.url), 'utf8'),
) as unknown[]

function demandingFixturePlan(
  input: ReturnType<typeof ExpeditionInputSchema.parse>,
): ExpeditionPlan {
  const route = normalizeRoute({
    coordinates: [
      [input.start.lng, input.start.lat, 0],
      [input.start.lng - 0.7806, input.start.lat + 0.725, 0],
      [input.destination.lng - 0.9692, input.destination.lat + 0.425, 0],
      [input.destination.lng, input.destination.lat, 0],
    ],
  })
  return buildExpeditionPlan(input, route, [], {
    routingProvider: 'test fixture',
    elevationProvider: 'test fixture',
    settlementProvider: 'test fixture',
    geocodingProvider: 'test fixture',
    source: 'live',
  })
}

async function useDemandingFixture(page: Page) {
  const requestDays: number[] = []
  await page.route('**/api/plan', (route) => {
    const input = ExpeditionInputSchema.parse(JSON.parse(route.request().postData() ?? '{}'))
    requestDays.push(input.days)
    const plan = demandingFixturePlan(input)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(plan),
    })
  })
  return requestDays
}

test('planner stays within Hallmark responsive layout constraints', async ({ page }) => {
  for (const width of [320, 375, 414, 768, 1280, 1920]) {
    const height = width === 1280 ? 800 : 900
    await page.setViewportSize({ width, height })
    await page.goto('/planner')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByRole('heading', { name: /Plan the ride/i })).toBeVisible()

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

  await page.goto('/planner?example=amsterdam-brussels')
  await expect(page.locator('.results-shell')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Start' })).toHaveValue(/Amsterdam/)
})

test('WebMCP registry exposes five structured tools without UI scraping', async ({ page }) => {
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
      'update_trip_constraints',
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

test('WebMCP can update constraints and retrieve the regenerated plan', async ({ page }) => {
  const initialPlan = structuredClone(fallbackPlans[0]) as ExpeditionPlan
  initialPlan.route.surfaceBreakdown = { paved: 50, unpaved: 25, unknown: 25 }
  initialPlan.suitability = { level: 'compatible' }
  initialPlan.stages[0].effort = {
    distanceLevel: 'moderate',
    climbingLevel: 'rolling',
    relativeLabels: ['longest-stage'],
  }
  const searchedLocation = {
    id: 'webmcp:search-result',
    label: 'WebMCP Search Result',
    lat: 37.7749,
    lng: -122.4194,
  }
  await page.route('**/api/geocode/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([searchedLocation]),
    }),
  )
  await page.route('**/api/plan', (route) => {
    const input = ExpeditionInputSchema.parse(JSON.parse(route.request().postData() ?? '{}'))
    const plan = structuredClone(initialPlan)
    plan.id = crypto.randomUUID()
    plan.input = input
    plan.summary.days = input.days
    plan.summary.averageDistanceMeters = plan.summary.totalDistanceMeters / input.days
    plan.feasibility.averageDistanceMeters = plan.summary.averageDistanceMeters
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(plan),
    })
  })
  await page.addInitScript(() => {
    const registered: Array<{
      name: string
      execute: (input: unknown) => Promise<unknown>
    }> = []
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool: (tool: (typeof registered)[number]) => registered.push(tool) },
    })
    Object.defineProperty(window, '__registeredWebMcpTools', { value: registered, writable: false })
  })
  await page.goto('/planner')
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __registeredWebMcpTools?: Array<{ name: string }>
            }
          ).__registeredWebMcpTools?.length,
      ),
    )
    .toBe(5)

  const result = await page.evaluate(async () => {
    const tools = (
      window as typeof window & {
        __registeredWebMcpTools: Array<{
          name: string
          execute: (input: unknown) => Promise<unknown>
        }>
      }
    ).__registeredWebMcpTools
    const execute = (name: string, input: unknown) =>
      tools.find((tool) => tool.name === name)?.execute(input)
    const searchResult = await execute('search_locations', { query: 'WebMCP' })
    const start = { id: 'webmcp:start', label: 'WebMCP Start', lat: 37.7749, lng: -122.4194 }
    const destination = {
      id: 'webmcp:destination',
      label: 'WebMCP Destination',
      lat: 36.9741,
      lng: -122.0308,
    }
    const setResult = await execute('set_trip_parameters', {
      start,
      destination,
      days: 3,
      bikeType: 'gravel',
      routeProfile: 'paved-priority',
      fitness: 'intermediate',
    })
    const initialGenerateResult = await execute('generate_expedition_plan', {})
    const initialPlanResult = await execute('get_expedition_plan', {})
    const updateDaysResult = await execute('update_trip_constraints', { days: 4 })
    const updateFitnessResult = await execute('update_trip_constraints', { fitness: 'beginner' })
    const updateProfileResult = await execute('update_trip_constraints', {
      routeProfile: 'mixed-surface',
    })
    const updateMultipleResult = await execute('update_trip_constraints', {
      days: 5,
      bikeType: 'touring',
    })
    const invalidEmptyPatch = await execute('update_trip_constraints', {})
    const invalidUnknownPatch = await execute('update_trip_constraints', { destination })
    const invalidEnumPatch = await execute('update_trip_constraints', { fitness: 'ultra' })
    const invalidDaysPatch = await execute('update_trip_constraints', { days: 8 })
    const beforeRegenerate = await execute('get_expedition_plan', {})
    const generateResult = await execute('generate_expedition_plan', {})
    const planResult = await execute('get_expedition_plan', {})
    return {
      setResult,
      searchResult,
      initialGenerateResult,
      initialPlanResult,
      updateDaysResult,
      updateFitnessResult,
      updateProfileResult,
      updateMultipleResult,
      invalidEmptyPatch,
      invalidUnknownPatch,
      invalidEnumPatch,
      invalidDaysPatch,
      beforeRegenerate,
      generateResult,
      planResult,
    }
  })

  expect(result.setResult).toMatchObject({ status: 'success' })
  expect(result.searchResult).toEqual({ status: 'success', locations: [searchedLocation] })
  expect(result.initialGenerateResult).toMatchObject({ status: 'success' })
  expect(result.initialPlanResult).toMatchObject({
    status: 'success',
    input: { days: 3 },
    surfaceBreakdown: { paved: 50, unpaved: 25, unknown: 25 },
    suitability: { level: 'compatible' },
  })
  expect(
    (result.initialPlanResult as { stages: Array<{ effort?: unknown }> }).stages[0]?.effort,
  ).toEqual({
    distanceLevel: 'moderate',
    climbingLevel: 'rolling',
    relativeLabels: ['longest-stage'],
  })
  expect((result.initialPlanResult as { planId: string }).planId).toBe(
    (result.initialGenerateResult as { planId: string }).planId,
  )
  expect(result.updateDaysResult).toMatchObject({
    status: 'success',
    updatedFields: ['days'],
    draft: {
      start: { id: 'webmcp:start', label: 'WebMCP Start' },
      destination: { id: 'webmcp:destination', label: 'WebMCP Destination' },
      days: 4,
    },
  })
  expect(result.updateFitnessResult).toMatchObject({
    status: 'success',
    updatedFields: ['fitness'],
    draft: { days: 4, fitness: 'beginner' },
  })
  expect(result.updateProfileResult).toMatchObject({
    status: 'success',
    updatedFields: ['routeProfile'],
    draft: { days: 4, fitness: 'beginner', routeProfile: 'mixed-surface' },
  })
  expect(result.updateMultipleResult).toMatchObject({
    status: 'success',
    updatedFields: ['days', 'bikeType'],
    draft: {
      start: { id: 'webmcp:start', label: 'WebMCP Start' },
      destination: { id: 'webmcp:destination', label: 'WebMCP Destination' },
      days: 5,
      bikeType: 'touring',
      routeProfile: 'mixed-surface',
      fitness: 'beginner',
    },
  })
  expect(result.invalidEmptyPatch).toMatchObject({
    status: 'error',
    error: { code: 'INVALID_INPUT' },
  })
  expect(result.invalidUnknownPatch).toMatchObject({
    status: 'error',
    error: { code: 'INVALID_INPUT' },
  })
  expect(result.invalidEnumPatch).toMatchObject({
    status: 'error',
    error: { code: 'INVALID_INPUT' },
  })
  expect(result.invalidDaysPatch).toMatchObject({
    status: 'error',
    error: { code: 'INVALID_INPUT' },
  })
  expect(result.beforeRegenerate).toMatchObject({
    status: 'success',
    input: { days: 3 },
  })
  expect((result.beforeRegenerate as { planId: string }).planId).toBe(
    (result.initialGenerateResult as { planId: string }).planId,
  )
  expect(result.generateResult).toMatchObject({ status: 'success' })
  expect(result.planResult).toMatchObject({
    status: 'success',
    input: {
      start: { id: 'webmcp:start', label: 'WebMCP Start' },
      destination: { id: 'webmcp:destination', label: 'WebMCP Destination' },
      days: 5,
      bikeType: 'touring',
      routeProfile: 'mixed-surface',
      fitness: 'beginner',
    },
    summary: { days: 5 },
  })
  expect((result.planResult as { planId: string }).planId).toBe(
    (result.generateResult as { planId: string }).planId,
  )
  expect((result.generateResult as { planId: string }).planId).not.toBe(
    (result.initialGenerateResult as { planId: string }).planId,
  )
  const finalPlanId = (result.generateResult as { planId: string }).planId
  expect(result.planResult).not.toHaveProperty('route')
  expect(JSON.stringify(result.planResult)).not.toContain('coordinates')
  await expect(page.locator('.result-footnote button')).toHaveText(`${finalPlanId.slice(0, 18)}…`)
  await expect(page.locator('#days')).toHaveValue('5')
  await expect(page.locator('#bike')).toHaveValue('touring')
  await expect(page.locator('#profile')).toHaveValue('mixed-surface')
  await expect(page.locator('#fitness')).toHaveValue('beginner')
})

test('planner applies the recommended day count in one action', async ({ page }) => {
  const requestDays = await useDemandingFixture(page)
  await page.goto('/planner?example=sf-santa-cruz')
  await page.locator('#fitness').selectOption('beginner')
  await page.getByRole('button', { name: /Generate expedition/i }).click()
  await expect(page.getByText('Consider 5 days')).toBeVisible()
  await expect(page.getByText('3 stages')).toBeVisible()
  await expect(page.locator('.stage-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Use 5 days', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Use 5 days', exact: true }).click()
  await expect(page.getByText('5 riding days')).toBeVisible()
  await expect(page.getByText('5 stages')).toBeVisible()
  await expect(page.locator('.stage-card')).toHaveCount(5)
  await expect(page.getByText('Consider 5 days')).toHaveCount(0)
  expect(requestDays).toEqual([3, 5])
})

test('keeps the recommendation action contained across planner widths', async ({ page }) => {
  await useDemandingFixture(page)
  for (const width of [390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/planner?example=sf-santa-cruz')
    await page.locator('#fitness').selectOption('beginner')
    await page.getByRole('button', { name: /Generate expedition/i }).click()
    await expect(page.getByText('Consider 5 days')).toBeVisible()

    const dimensions = await page.evaluate(() => {
      const recommendation = document.querySelector('.feasibility-recommendation')
      const action = recommendation?.querySelector('button')
      const recommendationRect = recommendation?.getBoundingClientRect()
      const actionRect = action?.getBoundingClientRect()
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        recommendationWidth: recommendationRect?.width ?? 0,
        actionLeft: actionRect?.left ?? -1,
        actionRight: actionRect?.right ?? Number.POSITIVE_INFINITY,
      }
    })
    expect(dimensions.scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(
      dimensions.innerWidth + 1,
    )
    expect(dimensions.recommendationWidth).toBeLessThanOrEqual(dimensions.innerWidth)
    expect(dimensions.actionLeft).toBeGreaterThanOrEqual(0)
    expect(dimensions.actionRight).toBeLessThanOrEqual(dimensions.innerWidth + 1)
  }
})

test('does not apply a stale recommendation to edited draft constraints', async ({ page }) => {
  const requestDays = await useDemandingFixture(page)
  await page.goto('/planner?example=sf-santa-cruz')
  await page.locator('#fitness').selectOption('beginner')
  await page.getByRole('button', { name: /Generate expedition/i }).click()
  await expect(page.getByRole('button', { name: 'Use 5 days', exact: true })).toBeEnabled()

  await page.locator('#fitness').selectOption('experienced')
  await expect(
    page.getByText('Trip settings changed. Regenerate to refresh this recommendation.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use 5 days', exact: true })).toBeDisabled()
  await expect(page.getByText('3 riding days')).toBeVisible()
  await expect(page.locator('#fitness')).toHaveValue('experienced')
  expect(requestDays).toEqual([3])
})

test('retains the successful plan after a failed recommendation replan', async ({ page }) => {
  let requestCount = 0
  await page.route('**/api/plan', (route) => {
    requestCount += 1
    if (requestCount === 2) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'ROUTING_FAILED',
          message: 'The routing provider could not complete the request.',
          retryable: true,
        }),
      })
    }
    const input = ExpeditionInputSchema.parse(JSON.parse(route.request().postData() ?? '{}'))
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(demandingFixturePlan(input)),
    })
  })
  await page.goto('/planner?example=sf-santa-cruz')
  await page.locator('#fitness').selectOption('beginner')
  await page.getByRole('button', { name: /Generate expedition/i }).click()
  await expect(page.getByText('Consider 5 days')).toBeVisible()

  const planIdBefore = await page.locator('.result-footnote button').textContent()
  const resultHeadingBefore = await page.locator('.result-heading h2').textContent()
  const summaryBefore = await page.locator('.summary-grid').textContent()
  const stageCountBefore = await page.locator('.stage-card').count()

  await page.getByRole('button', { name: 'Use 5 days', exact: true }).click()
  await expect(page.locator('.error-panel')).toContainText('ROUTING FAILED')
  await expect(page.locator('.error-panel')).toContainText('last successful plan is still visible')
  await expect(page.locator('.results-shell')).toBeVisible()
  await expect(page.locator('#days')).toHaveValue('5')
  await expect(page.locator('#days')).toBeEnabled()
  await expect(
    page.getByText('Trip settings changed. Regenerate to refresh this recommendation.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use 5 days', exact: true })).toBeDisabled()
  await expect(page.locator('.result-footnote button')).toHaveText(planIdBefore ?? '')
  await expect(page.locator('.result-heading h2')).toHaveText(resultHeadingBefore ?? '')
  await expect(page.locator('.summary-grid')).toHaveText(summaryBefore ?? '')
  await expect(page.locator('.stage-card')).toHaveCount(stageCountBefore)
  await expect(page.getByText('3 riding days')).toBeVisible()

  await page.goto('/planner')
  await expect(page.locator('.results-shell')).toBeVisible()
  await expect(page.locator('.result-footnote button')).toHaveText(planIdBefore ?? '')
  await expect(page.locator('.result-heading h2')).toHaveText(resultHeadingBefore ?? '')
  await expect(page.locator('.summary-grid')).toHaveText(summaryBefore ?? '')
  await expect(page.locator('.stage-card')).toHaveCount(stageCountBefore)
  await expect(page.getByText('3 riding days')).toBeVisible()
  await expect(page.locator('.error-panel')).toHaveCount(0)
})

test('returns PLAN_IN_PROGRESS for a valid update while generating', async ({ page }) => {
  let releaseRequest: () => void = () => undefined
  let requestStartedResolve: () => void = () => undefined
  const requestStarted = new Promise<void>((resolve) => {
    requestStartedResolve = resolve
  })
  const requestRelease = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  await page.route('**/api/plan', async (route) => {
    requestStartedResolve()
    await requestRelease
    const input = ExpeditionInputSchema.parse(JSON.parse(route.request().postData() ?? '{}'))
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(demandingFixturePlan(input)),
    })
  })
  await page.addInitScript(() => {
    const registered: Array<{
      name: string
      execute: (input: unknown) => Promise<unknown>
    }> = []
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool: (tool: (typeof registered)[number]) => registered.push(tool) },
    })
    Object.defineProperty(window, '__registeredWebMcpTools', { value: registered, writable: false })
  })
  await page.goto('/planner')
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __registeredWebMcpTools?: Array<{ name: string }>
            }
          ).__registeredWebMcpTools?.length,
      ),
    )
    .toBe(5)

  const setResult = await page.evaluate(async () => {
    const tools = (
      window as typeof window & {
        __registeredWebMcpTools: Array<{
          name: string
          execute: (input: unknown) => Promise<unknown>
        }>
      }
    ).__registeredWebMcpTools
    return tools
      .find((tool) => tool.name === 'set_trip_parameters')
      ?.execute({
        start: { id: 'busy:start', label: 'Busy Start', lat: 37.7749, lng: -122.4194 },
        destination: {
          id: 'busy:destination',
          label: 'Busy Destination',
          lat: 36.9741,
          lng: -122.0308,
        },
        days: 3,
        bikeType: 'gravel',
        routeProfile: 'paved-priority',
        fitness: 'beginner',
      })
  })
  expect(setResult).toMatchObject({ status: 'success' })

  const generatePromise = page.evaluate(async () => {
    const tools = (
      window as typeof window & {
        __registeredWebMcpTools: Array<{
          name: string
          execute: (input: unknown) => Promise<unknown>
        }>
      }
    ).__registeredWebMcpTools
    return tools.find((tool) => tool.name === 'generate_expedition_plan')?.execute({})
  })
  await requestStarted

  const updateResult = await page.evaluate(async () => {
    const tools = (
      window as typeof window & {
        __registeredWebMcpTools: Array<{
          name: string
          execute: (input: unknown) => Promise<unknown>
        }>
      }
    ).__registeredWebMcpTools
    return tools.find((tool) => tool.name === 'update_trip_constraints')?.execute({ days: 4 })
  })
  expect(updateResult).toMatchObject({
    status: 'error',
    error: { code: 'PLAN_IN_PROGRESS' },
  })
  await expect(page.locator('#days')).toHaveValue('3')

  releaseRequest()
  await expect(generatePromise).resolves.toMatchObject({ status: 'success' })
  await expect(page.locator('#days')).toHaveValue('3')
})
