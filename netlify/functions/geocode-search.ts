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
    const limit = allowPublicRequest(event as FunctionEvent, 'geocode-search', 20, 60_000)
    if (!limit.allowed) return rateLimitedResponse(id, limit.retryAfterSeconds)
    const query = queryValue(event as FunctionEvent, 'q') ?? ''
    if (query.length > 160) throw new ApplicationError('INVALID_INPUT', 'Search query is too long.')
    const results = await createComposition().searchLocations.execute(
      query,
      executionContext(id, 8_000),
    )
    return jsonResponse(id, results)
  } catch (error) {
    return errorResponse(id, error)
  }
}
