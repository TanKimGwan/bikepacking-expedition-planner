import type { Handler } from '@netlify/functions'

import { allowPublicRequest } from '../../src/server/abuse-control'
import { createComposition } from '../../src/server/composition'
import { ApplicationError } from '../../src/server/errors'
import {
  errorResponse,
  executionContext,
  jsonResponse,
  queryValue,
  requestId,
  rateLimitedResponse,
  type FunctionEvent,
} from '../../src/server/transport'

export const handler: Handler = async (event) => {
  const id = requestId()
  try {
    const limit = allowPublicRequest(event as FunctionEvent, 'geocode-reverse', 20, 60_000)
    if (!limit.allowed) return rateLimitedResponse(id, limit.retryAfterSeconds)
    const latValue = queryValue(event as FunctionEvent, 'lat')
    const lngValue = queryValue(event as FunctionEvent, 'lng')
    if ((latValue?.length ?? 0) > 32 || (lngValue?.length ?? 0) > 32)
      throw new ApplicationError('INVALID_INPUT', 'Coordinates are too long.')
    const lat = Number(latValue)
    const lng = Number(lngValue)
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new ApplicationError(
        'INVALID_INPUT',
        'Latitude and longitude must be valid coordinates.',
      )
    }
    const result = await createComposition().reverseGeocode.execute(
      lat,
      lng,
      executionContext(id, 8_000),
    )
    return jsonResponse(id, result)
  } catch (error) {
    return errorResponse(id, error)
  }
}
