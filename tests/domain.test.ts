import { describe, expect, it } from 'vitest'

import { buildGpx, sanitizeFilename } from '@/application/gpx'
import { PRESETS, type PresetId } from '@/application/presets'
import { cachedPlanFor } from '@/server/fallback'
import { haversineMeters } from '@shared/domain/geo'
import { ExpeditionInputSchema } from '@shared/contracts/expedition'
import {
  ELEVATION_RECONCILIATION_TOLERANCE_METERS,
  normalizeRoute,
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

  it('does not expose a cached route with implausible elevation', () => {
    const planInput = ExpeditionInputSchema.parse({
      ...PRESETS['bandung-pangandaran'].input,
      days: 6,
    })

    expect(cachedPlanFor(planInput)).toBeNull()
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
