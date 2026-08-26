import { z } from 'zod'

import type { ExpeditionInput } from '@shared/contracts/expedition'
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
const OrsResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({ type: z.literal('LineString'), coordinates: CoordinatesSchema }),
        properties: z.object({
          summary: z.object({ distance: z.number().finite().positive() }),
          ascent: z.number().finite().nonnegative().optional(),
          descent: z.number().finite().nonnegative().optional(),
        }),
      }),
    )
    .min(1),
})

export class OrsRoutingProvider implements RoutingProvider {
  constructor(private readonly apiKey: string) {}

  async route(input: ExpeditionInput, context: ExecutionContext): Promise<ProviderRoute> {
    const profile = input.routeProfile === 'paved-priority' ? 'cycling-road' : 'cycling-mountain'
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
    }
  }
}
