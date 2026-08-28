import { z } from 'zod'

import type { ExpeditionInput, SurfaceBreakdown } from '@shared/contracts/expedition'
import type { ProviderRoute } from '@shared/domain/planning'
import type { ExecutionContext } from '../network'
import { fetchJson } from '../network'
import type { RoutingProvider } from './types'

const CoordinatesSchema = z
  .array(
    z.tuple([
      z.number().finite().min(-180).max(180),
      z.number().finite().min(-90).max(90),
      z.number().finite().optional(),
    ]),
  )
  .min(2)
const OrsSurfaceSummarySchema = z.object({
  value: z.number().int().finite().nonnegative(),
  amount: z.number().finite().min(0).max(100),
})
const OrsSurfaceExtrasSchema = z.object({
  summary: z.array(OrsSurfaceSummarySchema).min(1),
})
const OrsResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({ type: z.literal('LineString'), coordinates: CoordinatesSchema }),
        properties: z.object({
          summary: z.object({ distance: z.number().finite().positive() }),
          ascent: z.number().finite().nonnegative().optional(),
          descent: z.number().finite().nonnegative().optional(),
          extras: z.unknown().optional(),
        }),
      }),
    )
    .min(1),
})

export type OrsRoutingProfile = 'cycling-road' | 'cycling-regular' | 'cycling-mountain'

export const ORS_PROFILE_BY_ROUTE_PROFILE = {
  'paved-priority': 'cycling-road',
  'mixed-surface': 'cycling-regular',
} as const satisfies Record<ExpeditionInput['routeProfile'], OrsRoutingProfile>

export function orsProfileForRouteProfile(
  routeProfile: ExpeditionInput['routeProfile'],
): OrsRoutingProfile {
  return ORS_PROFILE_BY_ROUTE_PROFILE[routeProfile]
}

// ponytail: three surface categories keep the contract readable; add provider-specific classes only when the UI can explain them.
const PAVED_SURFACE_IDS = new Set([1, 3, 4, 14])
const UNPAVED_SURFACE_IDS = new Set([2, 6, 7, 8, 10, 11, 12, 13, 15, 17, 18])

function normalizeSurfaceBreakdown(extras: unknown): SurfaceBreakdown | undefined {
  const parsed = OrsSurfaceExtrasSchema.safeParse(
    extras && typeof extras === 'object' && 'surface' in extras
      ? (extras as { surface?: unknown }).surface
      : undefined,
  )
  if (!parsed.success) return undefined

  const totals = { paved: 0, unpaved: 0, unknown: 0 }
  for (const item of parsed.data.summary) {
    const category = PAVED_SURFACE_IDS.has(item.value)
      ? 'paved'
      : UNPAVED_SURFACE_IDS.has(item.value)
        ? 'unpaved'
        : 'unknown'
    totals[category] += item.amount
  }
  const total = totals.paved + totals.unpaved + totals.unknown
  if (!Number.isFinite(total) || total <= 0) return undefined

  const paved = Number(((totals.paved / total) * 100).toFixed(2))
  const unpaved = Number(((totals.unpaved / total) * 100).toFixed(2))
  return {
    paved,
    unpaved,
    unknown: Number(Math.max(0, 100 - paved - unpaved).toFixed(2)),
  }
}

export class OrsRoutingProvider implements RoutingProvider {
  constructor(private readonly apiKey: string) {}

  async route(input: ExpeditionInput, context: ExecutionContext): Promise<ProviderRoute> {
    return this.routeWithProfile(input, context, orsProfileForRouteProfile(input.routeProfile))
  }

  // Validation uses this to compare a diagnostic provider profile through the same adapter.
  async routeWithProfile(
    input: ExpeditionInput,
    context: ExecutionContext,
    profile: OrsRoutingProfile,
  ): Promise<ProviderRoute> {
    const response = await fetchJson(
      context,
      `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
      {
        method: 'POST',
        headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: [
            [input.start.lng, input.start.lat],
            [input.destination.lng, input.destination.lat],
          ],
          instructions: false,
          elevation: true,
          extra_info: ['surface'],
        }),
      },
      OrsResponseSchema,
      {
        timeoutMs: 8_000,
        failureCode: 'ROUTING_FAILED',
        notFoundCode: 'ROUTE_NOT_FOUND',
        provider: 'ORS routing',
      },
    )
    const feature = response.features[0]
    return {
      coordinates: feature.geometry.coordinates.map(([lng, lat, elevation]) =>
        elevation === undefined ? [lng, lat] : [lng, lat, elevation],
      ),
      distanceMeters: feature.properties.summary.distance,
      ascentMeters: feature.properties.ascent,
      descentMeters: feature.properties.descent,
      surfaceBreakdown: normalizeSurfaceBreakdown(feature.properties.extras),
    }
  }
}
