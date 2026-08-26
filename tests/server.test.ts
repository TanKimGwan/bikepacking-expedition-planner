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
    ['mixed-surface', 'cycling-mountain'],
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
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('ORS response boundary', () => {
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
