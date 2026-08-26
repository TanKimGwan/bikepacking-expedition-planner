import { LocationSearchResponseSchema } from '@shared/contracts/geocoding'
import { CanonicalLocationSchema, type CanonicalLocation } from '@shared/contracts/expedition'

import { apiRequest } from './client'

export function searchLocations(query: string): Promise<CanonicalLocation[]> {
  return apiRequest(
    `/api/geocode/search?q=${encodeURIComponent(query)}`,
    LocationSearchResponseSchema,
  )
}

export function reverseGeocode(lat: number, lng: number): Promise<CanonicalLocation | null> {
  return apiRequest(
    `/api/geocode/reverse?lat=${lat}&lng=${lng}`,
    CanonicalLocationSchema.nullable(),
  )
}
