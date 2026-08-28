import { describe, expect, it } from 'vitest'

import { buildGpx, sanitizeFilename } from '@/application/gpx'
import { PRESETS, type PresetId } from '@/application/presets'
import { cachedPlanFor } from '@/server/fallback'
import fallbackPlans from '@/server/fallback-plans.json'
import { haversineMeters } from '@shared/domain/geo'
import { ExpeditionInputSchema, TripConstraintPatchSchema } from '@shared/contracts/expedition'
import {
  ELEVATION_RECONCILIATION_TOLERANCE_METERS,
  normalizeRoute,
  recommendedDaysFor,
  routeSuitabilityFor,
  tripDraftMatchesInput,
  validatePlanningLimits,
  buildExpeditionPlan,
} from '@shared/domain/planning'
import type { ExpeditionInput } from '@shared/contracts/expedition'

const input: ExpeditionInput = {
  start: { id: 'start', label: 'Start', lat: 0, lng: 0 },
  destination: { id: 'destination', label: 'Destination', lat: 0.2, lng: 0 },
  days: 3,
  bikeType: 'gravel',
  routeProfile: 'paved-priority',
  fitness: 'intermediate',
}

describe('planning domain', () => {
  it('calculates a great-circle distance in meters', () => {
    expect(haversineMeters([0, 0], [0, 1])).toBeGreaterThan(111_000)
    expect(haversineMeters([0, 0], [0, 1])).toBeLessThan(112_000)
  })

  it('normalizes cumulative distance and elevation once', () => {
    const route = normalizeRoute(
      {
        coordinates: [
          [0, 0, 100],
          [0, 0.1, 200],
          [0, 0.2, 150],
        ],
      },
      10_000,
    )
    expect(route.distanceMeters).toBeGreaterThan(22_000)
    expect(route.points.at(-1)?.distanceFromStartMeters).toBe(route.distanceMeters)
    expect(route.ascentMeters).toBeCloseTo(100)
    expect(route.descentMeters).toBeCloseTo(50)
  })

  it('uses a finite provider distance as the canonical route total', () => {
    const route = normalizeRoute(
      {
        coordinates: [
          [0, 0, 100],
          [0, 0.1, 200],
          [0, 0.2, 150],
        ],
        distanceMeters: 999_999,
      },
      10_000,
    )

    expect(route.distanceMeters).toBe(999_999)
    expect(route.points.at(-1)?.distanceFromStartMeters).toBe(999_999)
    expect(route.elevationPoints?.at(-1)?.distanceFromStartMeters).toBe(999_999)
    const plan = buildExpeditionPlan(input, route, [], {
      routingProvider: 'test',
      elevationProvider: 'test',
      settlementProvider: 'test',
      geocodingProvider: 'test',
      source: 'live',
    })
    expect(plan.stages.reduce((total, stage) => total + stage.distanceMeters, 0)).toBeCloseTo(
      999_999,
      6,
    )
  })

  it('rejects an invalid provider distance while retaining the geometry fallback only when absent', () => {
    expect(
      normalizeRoute({
        coordinates: [
          [0, 0],
          [0, 0.2],
        ],
      }).distanceMeters,
    ).toBeGreaterThan(22_000)

    for (const distanceMeters of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        normalizeRoute({
          coordinates: [
            [0, 0],
            [0, 0.2],
          ],
          distanceMeters,
        }),
      ).toThrow('invalid route distance')
    }
  })

  it('rejects provider elevation sentinel values', () => {
    expect(() =>
      normalizeRoute({
        coordinates: [
          [0, 0, 10],
          [0, 0.01, -32768],
          [0, 0.02, 20],
        ],
      }),
    ).toThrow('implausible elevation')
  })

  it('rejects positive and negative short-distance elevation spikes', () => {
    for (const spike of [150, -150]) {
      expect(() =>
        normalizeRoute({
          coordinates: [
            [0, 0, 0],
            [0, 0.0005, spike],
            [0, 0.001, 0],
          ],
        }),
      ).toThrow('implausible elevation')
    }
  })

  it('rejects repeated short-distance elevation spikes', () => {
    expect(() =>
      normalizeRoute({
        coordinates: [
          [0, 0, 0],
          [0, 0.0005, 150],
          [0, 0.001, 0],
          [0, 0.0015, 150],
          [0, 0.002, 0],
        ],
      }),
    ).toThrow('implausible elevation')
  })

  it('accepts a steep climb spread over a plausible horizontal distance', () => {
    const route = normalizeRoute({
      coordinates: [
        [0, 0, 0],
        [0, 0.005, 200],
        [0, 0.01, 100],
      ],
    })

    expect(route.ascentMeters).toBeCloseTo(200)
    expect(route.descentMeters).toBeCloseTo(100)
  })

  it('rejects elevation outside a broad terrestrial range', () => {
    expect(() =>
      normalizeRoute({
        coordinates: [
          [0, 0, 0],
          [0, 0.01, 10_001],
        ],
      }),
    ).toThrow('implausible elevation')
  })

  it('accepts the configured normal elevation boundaries', () => {
    const route = normalizeRoute({
      coordinates: [
        [0, 0, -1_000],
        [0, 1, 10_000],
      ],
    })

    expect(route.ascentMeters).toBeCloseTo(11_000)
    expect(route.descentMeters).toBe(0)
  })

  it('recommends the smallest comfortable day count within the MVP range', () => {
    expect(recommendedDaysFor(333_000, 3, 'beginner')).toBe(5)
    expect(recommendedDaysFor(240_000, 3, 'beginner')).toBeUndefined()
    expect(recommendedDaysFor(240_001, 3, 'beginner')).toBe(4)
    expect(recommendedDaysFor(360_000, 3, 'intermediate')).toBeUndefined()
    expect(recommendedDaysFor(360_001, 3, 'intermediate')).toBe(4)
    expect(recommendedDaysFor(480_000, 3, 'experienced')).toBeUndefined()
    expect(recommendedDaysFor(480_001, 3, 'experienced')).toBe(4)
    expect(recommendedDaysFor(560_000, 3, 'beginner')).toBe(7)
    expect(recommendedDaysFor(560_001, 3, 'beginner')).toBeUndefined()
    expect(recommendedDaysFor(600_000, 7, 'beginner')).toBeUndefined()
    for (const distance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(recommendedDaysFor(distance, 3, 'beginner')).toBeUndefined()
    }
    for (const days of [0, 1, 8, 3.5]) {
      expect(recommendedDaysFor(333_000, days, 'beginner')).toBeUndefined()
    }

    const plan = buildExpeditionPlan(
      { ...input, fitness: 'beginner' },
      normalizeRoute({
        coordinates: [
          [0, 0, 0],
          [0, 3, 0],
        ],
      }),
      [],
      {
        routingProvider: 'test',
        elevationProvider: 'test',
        settlementProvider: 'test',
        geocodingProvider: 'test',
        source: 'live',
      },
    )
    expect(plan.feasibility.recommendedDays).toBe(5)
  })

  it('matches a draft only when route and planning constraints are unchanged', () => {
    const planInput: ExpeditionInput = { ...input, fitness: 'beginner' }
    expect(tripDraftMatchesInput(planInput, planInput)).toBe(true)
    expect(tripDraftMatchesInput({ ...planInput, fitness: 'experienced' }, planInput)).toBe(false)
    expect(
      tripDraftMatchesInput(
        { ...planInput, destination: { ...planInput.destination, lng: 0.3 } },
        planInput,
      ),
    ).toBe(false)
    expect(tripDraftMatchesInput({ days: planInput.days }, planInput)).toBe(false)
  })

  it('validates trip constraint patches strictly', () => {
    expect(TripConstraintPatchSchema.safeParse({ days: 5 }).success).toBe(true)
    expect(
      TripConstraintPatchSchema.safeParse({ fitness: 'beginner', routeProfile: 'mixed-surface' })
        .success,
    ).toBe(true)
    for (const patch of [{}, { days: 1 }, { days: undefined }, { start: 'elsewhere' }]) {
      expect(TripConstraintPatchSchema.safeParse(patch).success).toBe(false)
    }
  })

  it('classifies bike and route combinations without over-warning', () => {
    expect(routeSuitabilityFor('road', 'mixed-surface')).toMatchObject({
      level: 'caution',
      code: 'ROAD_BIKE_MIXED_SURFACE',
    })
    for (const bikeType of ['road', 'gravel', 'touring', 'mtb'] as const) {
      for (const routeProfile of ['paved-priority', 'mixed-surface'] as const) {
        const suitability = routeSuitabilityFor(bikeType, routeProfile)
        expect(suitability.level).toBe(
          bikeType === 'road' && routeProfile === 'mixed-surface' ? 'caution' : 'compatible',
        )
      }
    }
  })

  it('adds distance, climbing, and tied relative effort context to stages', () => {
    const route = normalizeRoute({
      coordinates: [
        [0, 0, 0],
        [0, 0.5, 100],
        [0, 1.2, 700],
        [0, 2.16, 1_800],
      ],
    })
    const plan = buildExpeditionPlan(
      {
        ...input,
        days: 3,
        fitness: 'beginner',
        destination: { ...input.destination, lat: 2.16 },
      },
      route,
      [
        { id: 'town-1', label: 'Town 1', lat: 0.5, lng: 0, settlementType: 'town' },
        { id: 'town-2', label: 'Town 2', lat: 1.2, lng: 0, settlementType: 'town' },
      ],
      {
        routingProvider: 'test',
        elevationProvider: 'test',
        settlementProvider: 'test',
        geocodingProvider: 'test',
        source: 'live',
      },
    )

    expect(plan.stages.map((stage) => stage.effort)).toEqual([
      { distanceLevel: 'light', climbingLevel: 'low', relativeLabels: [] },
      { distanceLevel: 'moderate', climbingLevel: 'rolling', relativeLabels: [] },
      {
        distanceLevel: 'demanding',
        climbingLevel: 'climbing-heavy',
        relativeLabels: ['longest-stage', 'most-climbing'],
      },
    ])

    const tiedPlan = buildExpeditionPlan(
      {
        ...input,
        days: 2,
        fitness: 'experienced',
        destination: { ...input.destination, lat: 2 },
      },
      normalizeRoute({
        coordinates: [
          [0, 0, 0],
          [0, 1, 100],
          [0, 2, 200],
        ],
      }),
      [],
      {
        routingProvider: 'test',
        elevationProvider: 'test',
        settlementProvider: 'test',
        geocodingProvider: 'test',
        source: 'live',
      },
    )
    expect(tiedPlan.stages.map((stage) => stage.effort?.relativeLabels)).toEqual([
      ['longest-stage', 'most-climbing'],
      ['longest-stage', 'most-climbing'],
    ])
  })

  it('reconciles stage ascent and descent with the full elevation sequence', () => {
    const route = normalizeRoute(
      {
        coordinates: [
          [0, 0, 0],
          [0, 0.01, 100],
          [0, 0.02, 0],
          [0, 0.03, 100],
          [0, 0.04, 0],
        ],
      },
      10_000,
    )
    const plan = buildExpeditionPlan({ ...input, days: 2 }, route, [], {
      routingProvider: 'test',
      elevationProvider: 'test',
      settlementProvider: 'test',
      geocodingProvider: 'test',
      source: 'live',
    })

    expect(route.points).toHaveLength(2)
    expect(route.elevationPoints).toHaveLength(5)
    expect(
      Math.abs(
        plan.stages.reduce((total, stage) => total + stage.ascentMeters, 0) - route.ascentMeters,
      ),
    ).toBeLessThanOrEqual(ELEVATION_RECONCILIATION_TOLERANCE_METERS)
    expect(
      Math.abs(
        plan.stages.reduce((total, stage) => total + stage.descentMeters, 0) - route.descentMeters,
      ),
    ).toBeLessThanOrEqual(ELEVATION_RECONCILIATION_TOLERANCE_METERS)
    expect(plan.stages[0].endDistanceMeters).toBe(plan.stages[1].startDistanceMeters)
  })

  it('rebalances stages and preserves the full route distance', () => {
    const route = normalizeRoute(
      {
        coordinates: [
          [0, 0, 100],
          [0, 0.1, 200],
          [0, 0.2, 150],
        ],
      },
      1_000,
    )
    const plan = buildExpeditionPlan(input, route, [], {
      routingProvider: 'test',
      elevationProvider: 'test',
      settlementProvider: 'test',
      geocodingProvider: 'test',
      source: 'live',
    })
    expect(plan.stages).toHaveLength(3)
    expect(plan.stages.reduce((total, stage) => total + stage.distanceMeters, 0)).toBeCloseTo(
      route.distanceMeters,
      3,
    )
    expect(plan.warnings.some((warning) => warning.code === 'NO_SETTLEMENT_DAY_1')).toBe(true)
    expect(plan.summary.estimatedTotalRidingTimeSeconds).toBeGreaterThan(0)
  })

  it('rejects a straight-line trip beyond the MVP limit', () => {
    expect(() =>
      validatePlanningLimits({ ...input, destination: { ...input.destination, lng: 20 } }),
    ).toThrow('1,000 km')
  })

  it('only exposes a cached fallback for a curated route', () => {
    const curated = cachedPlanFor({
      ...input,
      start: { id: 'start', label: 'San Francisco', lat: 37.7749, lng: -122.4194 },
      destination: { id: 'destination', label: 'Santa Cruz', lat: 36.9741, lng: -122.0308 },
    })
    expect(curated?.provenance.source).toBe('cached')
    expect(curated?.warnings.some((warning) => warning.code === 'CACHED_DEMO_FALLBACK')).toBe(true)
    expect(curated?.summary.totalDistanceMeters).toBeCloseTo(123_745.8, 1)
    expect(curated?.summary.totalAscentMeters).toBeCloseTo(1_937.1, 1)
    expect(cachedPlanFor(input)).toBeNull()
  })

  it('selects the matching cached route and replans its requested day count', () => {
    const cases: Array<[PresetId, number]> = [
      ['sf-santa-cruz', 2],
      ['amsterdam-brussels', 5],
    ]

    for (const [presetId, days] of cases) {
      const planInput = ExpeditionInputSchema.parse({ ...PRESETS[presetId].input, days })
      const plan = cachedPlanFor(planInput)

      expect(plan?.input).toEqual(planInput)
      expect(plan?.summary.days).toBe(days)
      expect(plan?.stages).toHaveLength(days)
      expect(plan?.route.geometry.coordinates[0]?.[0]).toBeCloseTo(planInput.start.lng, 3)
      expect(plan?.route.geometry.coordinates[0]?.[1]).toBeCloseTo(planInput.start.lat, 3)
      expect(plan?.provenance.source).toBe('cached')
      if (!plan) throw new Error('Expected a curated fallback plan')
      expect(plan.stages.every((stage) => !stage.end.label.startsWith('Route point near'))).toBe(
        true,
      )
      expect(plan.stages.reduce((total, stage) => total + stage.ascentMeters, 0)).toBeCloseTo(
        plan.route.ascentMeters,
        6,
      )
      expect(plan.stages.reduce((total, stage) => total + stage.descentMeters, 0)).toBeCloseTo(
        plan.route.descentMeters,
        6,
      )
    }
  })

  it('fails closed when a curated route has no profile-matched fallback', () => {
    const unsupportedProfiles: Array<[PresetId, ExpeditionInput['routeProfile']]> = [
      ['sf-santa-cruz', 'mixed-surface'],
      ['amsterdam-brussels', 'mixed-surface'],
      ['bandung-pangandaran', 'paved-priority'],
    ]

    for (const [presetId, routeProfile] of unsupportedProfiles) {
      const planInput = ExpeditionInputSchema.parse({ ...PRESETS[presetId].input, routeProfile })
      expect(cachedPlanFor(planInput)).toBeNull()
    }
  })

  it('keeps every cached template elevation total reconciled with its stages', () => {
    for (const template of fallbackPlans) {
      expect(template.stages.reduce((total, stage) => total + stage.ascentMeters, 0)).toBeCloseTo(
        template.route.ascentMeters,
        6,
      )
      expect(template.stages.reduce((total, stage) => total + stage.descentMeters, 0)).toBeCloseTo(
        template.route.descentMeters,
        6,
      )
    }
  })

  it('keeps the curated mixed-surface fallback on plausible elevation data', () => {
    const planInput = ExpeditionInputSchema.parse({
      ...PRESETS['bandung-pangandaran'].input,
      days: 6,
    })
    const plan = cachedPlanFor(planInput)

    expect(plan).not.toBeNull()
    expect(plan?.route.ascentMeters).toBeLessThan(10_000)
    expect(plan?.route.descentMeters).toBeLessThan(10_000)
  })
})

describe('GPX export', () => {
  it('escapes names and includes elevation points', () => {
    const route = normalizeRoute({
      coordinates: [
        [0, 0, 100],
        [0, 0.2, 150],
      ],
    })
    const plan = buildExpeditionPlan(
      { ...input, start: { ...input.start, label: 'A&B' } },
      route,
      [],
      {
        routingProvider: 'test',
        elevationProvider: 'test',
        settlementProvider: 'test',
        geocodingProvider: 'test',
        source: 'live',
      },
    )
    const gpx = buildGpx(plan)
    expect(gpx).toContain('A&amp;B')
    expect(gpx).toContain('<ele>100</ele>')
    expect(sanitizeFilename('  A&B / Santa Cruz  ')).toBe('a-b-santa-cruz')
  })
})
