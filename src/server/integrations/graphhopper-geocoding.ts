import { z } from 'zod'

import type { CanonicalLocation } from '@shared/contracts/expedition'
import type { ExecutionContext } from '../network'
import { fetchJson } from '../network'
import type { GeocodingProvider } from './types'

const GraphHopperHitSchema = z.object({
  name: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  countrycode: z.string().optional(),
  point: z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  }),
})
const GraphHopperGeocodeResponseSchema = z.object({ hits: z.array(GraphHopperHitSchema) })

function canonicalize(
  hit: z.infer<typeof GraphHopperHitSchema>,
  provider: string,
): CanonicalLocation {
  const label = [hit.name, hit.city, hit.state, hit.country]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(', ')
  return {
    id: `${provider}:${hit.point.lat.toFixed(5)},${hit.point.lng.toFixed(5)}`,
    label: label || `${hit.point.lat.toFixed(4)}, ${hit.point.lng.toFixed(4)}`,
    lat: hit.point.lat,
    lng: hit.point.lng,
    locality: hit.city ?? hit.name,
    region: hit.state,
    country: hit.country,
    countryCode: hit.countrycode,
  }
}

export class GraphHopperGeocodingProvider implements GeocodingProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, context: ExecutionContext): Promise<CanonicalLocation[]> {
    const url = new URL('https://graphhopper.com/api/1/geocode')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', '5')
    url.searchParams.set('locale', 'en')
    url.searchParams.set('key', this.apiKey)
    const response = await fetchJson(context, url, {}, GraphHopperGeocodeResponseSchema, {
      timeoutMs: 5_000,
      failureCode: 'UNKNOWN_ERROR',
      provider: 'GraphHopper geocoding',
    })
    return response.hits.map((hit) => canonicalize(hit, 'graphhopper'))
  }

  async reverse(
    lat: number,
    lng: number,
    context: ExecutionContext,
  ): Promise<CanonicalLocation | null> {
    const url = new URL('https://graphhopper.com/api/1/geocode')
    url.searchParams.set('point', `${lat},${lng}`)
    url.searchParams.set('reverse', 'true')
    url.searchParams.set('limit', '1')
    url.searchParams.set('locale', 'en')
    url.searchParams.set('key', this.apiKey)
    const response = await fetchJson(context, url, {}, GraphHopperGeocodeResponseSchema, {
      timeoutMs: 5_000,
      failureCode: 'UNKNOWN_ERROR',
      provider: 'GraphHopper reverse geocoding',
    })
    return response.hits[0] ? canonicalize(response.hits[0], 'graphhopper') : null
  }
}
