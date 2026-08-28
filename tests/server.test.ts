import { describe, expect, it, vi } from 'vitest'

import { ExpeditionInputSchema, type ProviderProvenance } from '@shared/contracts/expedition'
import { normalizeRoute } from '@shared/domain/planning'

import { PRESETS } from '@/application/presets'
import { PlanExpeditionUseCase } from '@/server/application/plan-expedition'
import { ApplicationError } from '@/server/errors'
import { cachedPlanFor } from '@/server/fallback'
import { OrsRoutingProvider } from '@/server/integrations/ors-routing'
import { OverpassSettlementProvider } from '@/server/integrations/overpass-settlements'
import { allowPublicRequest } from '@/server/abuse-control'
import { parseJsonBody, type FunctionEvent } from '@/server/transport'
import type { ExecutionContext } from '@/server/network'

const input = ExpeditionInputSchema.parse({
  start: { id: 'start', label: 'Start', lat: 0, lng: 0 },
  destination: { id: 'destination', label: 'Destination', lat: 0.2, lng: 0 },
  days: 3,
  bikeType: 'gravel',
  routeProfile: 'paved-priority',
  fitness: 'intermediate',
})
const provenance: ProviderProvenance = {
  routingProvider: 'test',
  elevationProvider: 'test',
  settlementProvider: 'test',
  geocodingProvider: 'test',
  source: 'live',
}
const context: ExecutionContext = {
  requestId: 'test-request',
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 10_000,
}

describe('PlanExpeditionUseCase', () => {
  it('orchestrates fake providers without depending on provider payloads', async () => {
    const route = normalizeRoute({
      coordinates: [
        [0, 0, 100],
        [0, 0.1, 140],
        [0, 0.2, 120],
      ],
    })
    const useCase = new PlanExpeditionUseCase(
      { route: vi.fn().mockResolvedValue({ coordinates: route.geometry.coordinates }) },
      {
        findAlongRoute: vi
          .fn()
          .mockResolvedValue([
            { id: 'town', label: 'Midway', lat: 0.1, lng: 0, settlementType: 'town' },
          ]),
      },
      provenance,
    )
    const plan = await useCase.execute(input, context)
    expect(plan.stages).toHaveLength(3)
    expect(plan.stages[0].end.label).toBe('Midway')
    expect(plan.provenance).toEqual(provenance)
  })

  it('rejects malformed user input before calling providers', async () => {
    const routeProvider = { route: vi.fn() }
    const useCase = new PlanExpeditionUseCase(
      routeProvider,
      { findAlongRoute: vi.fn() },
      provenance,
    )
    await expect(useCase.execute({ days: 99 }, context)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    expect(routeProvider.route).not.toHaveBeenCalled()
  })

  it('uses the matching cached demo plan after a live routing failure', async () => {
    const curatedInput = ExpeditionInputSchema.parse(PRESETS['amsterdam-brussels'].input)
    const useCase = new PlanExpeditionUseCase(
      {
        route: vi.fn().mockRejectedValue(new ApplicationError('ROUTING_FAILED', 'temporary', true)),
      },
      { findAlongRoute: vi.fn() },
      provenance,
      cachedPlanFor,
    )
    const plan = await useCase.execute(curatedInput, context)

    expect(plan.provenance.source).toBe('cached')
    expect(plan.input).toEqual(curatedInput)
    expect(plan.warnings.some((warning) => warning.code === 'CACHED_DEMO_FALLBACK')).toBe(true)
  })

  it('rejects a routed distance beyond 1,000 km before settlement lookup', async () => {
    const settlementProvider = { findAlongRoute: vi.fn() }
    const useCase = new PlanExpeditionUseCase(
      {
        route: vi.fn().mockResolvedValue({
          coordinates: [
            [0, 0],
            [10, 0],
            [0, 0.2],
          ],
        }),
      },
      settlementProvider,
      provenance,
    )

    await expect(useCase.execute(input, context)).rejects.toMatchObject({
      code: 'ROUTE_TOO_LONG',
    })
    expect(settlementProvider.findAlongRoute).not.toHaveBeenCalled()
  })

  it.each([
    [999_999, true],
    [1_000_000, true],
    [1_000_001, false],
  ])('enforces the provider routed-distance cap at %d meters', async (distanceMeters, allowed) => {
    const settlementProvider = { findAlongRoute: vi.fn().mockResolvedValue([]) }
    const useCase = new PlanExpeditionUseCase(
      {
        route: vi.fn().mockResolvedValue({
          coordinates: [
            [0, 0],
            [0, 0.1],
            [0, 0.2],
          ],
          distanceMeters,
        }),
      },
      settlementProvider,
      provenance,
    )

    if (allowed) {
      const plan = await useCase.execute(input, context)
      expect(plan.route.distanceMeters).toBe(distanceMeters)
      expect(plan.stages.reduce((total, stage) => total + stage.distanceMeters, 0)).toBeCloseTo(
        distanceMeters,
        6,
      )
      expect(settlementProvider.findAlongRoute).toHaveBeenCalledOnce()
    } else {
      await expect(useCase.execute(input, context)).rejects.toMatchObject({
        code: 'ROUTE_TOO_LONG',
      })
      expect(settlementProvider.findAlongRoute).not.toHaveBeenCalled()
    }
  })

  it('maps implausible route elevation to PROVIDER_RESPONSE_INVALID', async () => {
    const useCase = new PlanExpeditionUseCase(
      {
        route: vi.fn().mockResolvedValue({
          coordinates: [
            [0, 0, 0],
            [0, 0.0005, 150],
            [0, 0.2, 0],
          ],
        }),
      },
      { findAlongRoute: vi.fn() },
      provenance,
    )

    await expect(useCase.execute(input, context)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
    })
  })

  it('preserves settlement transport failures as explicit errors', async () => {
    const useCase = new PlanExpeditionUseCase(
      {
        route: vi.fn().mockResolvedValue({
          coordinates: [
            [0, 0, 100],
            [0, 0.1, 120],
            [0, 0.2, 80],
          ],
        }),
      },
      {
        findAlongRoute: vi
          .fn()
          .mockRejectedValue(new ApplicationError('SETTLEMENT_LOOKUP_FAILED', 'temporary', true)),
      },
      provenance,
    )

    await expect(useCase.execute(input, context)).rejects.toMatchObject({
      code: 'SETTLEMENT_LOOKUP_FAILED',
    })
  })
})

describe('ORS production profile mapping', () => {
  it.each([
    ['paved-priority', 'cycling-road'],
    ['mixed-surface', 'cycling-regular'],
  ] as const)('maps %s to %s', async (routeProfile, providerProfile) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            {
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0, 0],
                  [0, 0.2, 0],
                ],
              },
              properties: { summary: { distance: 22_000 }, ascent: 0, descent: 0 },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      await new OrsRoutingProvider('test-key').route({ ...input, routeProfile }, context)
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/directions/${providerProfile}/`)
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).extra_info).toEqual(['surface'])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('ORS response boundary', () => {
  it('normalizes documented surface categories into a canonical breakdown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [0, 0, 0],
                    [0, 0.2, 0],
                  ],
                },
                properties: {
                  summary: { distance: 22_000 },
                  extras: {
                    surface: {
                      summary: [
                        { value: 3, distance: 11_000, amount: 50 },
                        { value: 10, distance: 5_500, amount: 25 },
                        { value: 0, distance: 5_500, amount: 25 },
                      ],
                    },
                  },
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    try {
      await expect(new OrsRoutingProvider('test-key').route(input, context)).resolves.toMatchObject(
        {
          surfaceBreakdown: { paved: 50, unpaved: 25, unknown: 25 },
        },
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps a valid route when optional surface metadata is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [0, 0, 0],
                    [0, 0.2, 0],
                  ],
                },
                properties: {
                  summary: { distance: 22_000 },
                  extras: { surface: { summary: [{ value: 'future', amount: 100 }] } },
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    try {
      const route = await new OrsRoutingProvider('test-key').route(input, context)
      expect(route).toMatchObject({
        coordinates: [
          [0, 0, 0],
          [0, 0.2, 0],
        ],
      })
      expect(route.surfaceBreakdown).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps a malformed successful payload to PROVIDER_RESPONSE_INVALID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [] }), { status: 200 })),
    )
    const provider = new OrsRoutingProvider('test-key')
    await expect(provider.route(input, context)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
    })
    vi.unstubAllGlobals()
  })

  it('rejects successful payloads with out-of-range coordinates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [181, 0],
                    [0, 0],
                  ],
                },
                properties: { summary: { distance: 1_000 } },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const provider = new OrsRoutingProvider('test-key')
    await expect(provider.route(input, context)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
    })
    vi.unstubAllGlobals()
  })

  it('does not expose raw provider error payloads', () => {
    const error = new ApplicationError(
      'ROUTING_FAILED',
      'The routing provider could not complete the request.',
      true,
    )
    expect(error.message).not.toContain('test-key')
  })
})

describe('Overpass production corridor adapter', () => {
  it('queries sampled geometry and returns normalized settlement candidates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          elements: [
            { type: 'node', id: 42, lat: 0.1, lon: 0, tags: { name: 'Midway', place: 'town' } },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const route = normalizeRoute({
        coordinates: [
          [0, 0, 100],
          [0, 0.05, 120],
          [0, 0.1, 140],
          [0, 0.15, 120],
          [0, 0.2, 100],
        ],
      })
      const settlements = await new OverpassSettlementProvider().findAlongRoute(route, context)
      const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body)

      expect(settlements).toEqual([
        expect.objectContaining({ id: 'osm:node:42', label: 'Midway', settlementType: 'town' }),
      ])
      expect(decodeURIComponent(requestBody)).toContain('around:2000,0.1,0')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('public endpoint abuse controls', () => {
  it('bounds repeated requests and oversized plan bodies', () => {
    const event: FunctionEvent = {
      headers: { 'x-nf-client-connection-ip': `test-${crypto.randomUUID()}` },
    }
    expect(allowPublicRequest(event, 'plan', 2, 60_000).allowed).toBe(true)
    expect(allowPublicRequest(event, 'plan', 2, 60_000).allowed).toBe(true)
    const blocked = allowPublicRequest(event, 'plan', 2, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)

    expect(() => parseJsonBody({ headers: {}, body: 'x'.repeat(32_769) })).toThrow(
      'Request body is too large',
    )
  })
})
