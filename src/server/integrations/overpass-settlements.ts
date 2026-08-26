import { z } from 'zod'

import type { CanonicalLocation, NormalizedRoute } from '@shared/contracts/expedition'
import type { ExecutionContext } from '../network'
import { fetchJson } from '../network'
import type { SettlementProvider } from './types'

const OverpassElementSchema = z.object({
  type: z.enum(['node', 'way', 'relation']),
  id: z.number().int(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lon: z.number().finite().min(-180).max(180).optional(),
  center: z
    .object({
      lat: z.number().finite().min(-90).max(90),
      lon: z.number().finite().min(-180).max(180),
    })
    .optional(),
  tags: z
    .object({
      name: z.string().optional(),
      'name:en': z.string().optional(),
      place: z.enum(['city', 'town', 'village', 'hamlet']).optional(),
    })
    .optional(),
})
const OverpassResponseSchema = z.object({ elements: z.array(OverpassElementSchema) })

export class OverpassSettlementProvider implements SettlementProvider {
  async findAlongRoute(
    route: NormalizedRoute,
    context: ExecutionContext,
  ): Promise<CanonicalLocation[]> {
    // A small corridor sample keeps Overpass within the synchronous Netlify budget.
    const sampleStep = Math.max(1, Math.ceil(route.geometry.coordinates.length / 4))
    const sample = route.geometry.coordinates
      .filter((_, index) => index % sampleStep === 0)
      .slice(0, 4)
    const clauses = sample
      .map(
        ([lng, lat]) => `nwr["place"~"^(city|town|village|hamlet)$"](around:2000,${lat},${lng});`,
      )
      .join('')
    const query = `[out:json][timeout:8];(${clauses});out center tags;`
    const response = await fetchJson(
      context,
      'https://overpass-api.de/api/interpreter',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'bikepacking-expedition-planner/0.1',
        },
        body: `data=${encodeURIComponent(query)}`,
      },
      OverpassResponseSchema,
      {
        timeoutMs: 12_000,
        failureCode: 'SETTLEMENT_LOOKUP_FAILED',
        provider: 'OpenStreetMap Overpass',
      },
    )
    return response.elements.flatMap((element) => {
      const tags = element.tags
      const coordinates =
        element.center ??
        (element.lat !== undefined && element.lon !== undefined
          ? { lat: element.lat, lon: element.lon }
          : undefined)
      const name = tags?.['name:en'] ?? tags?.name
      if (!tags?.place || !name || !coordinates) return []
      return [
        {
          id: `osm:${element.type}:${element.id}`,
          label: name,
          lat: coordinates.lat,
          lng: coordinates.lon,
          settlementType: tags.place,
        },
      ]
    })
  }
}
