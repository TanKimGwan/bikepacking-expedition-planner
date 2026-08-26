import type { Handler } from '@netlify/functions'

import { allowPublicRequest } from '../../src/server/abuse-control'
import { createComposition } from '../../src/server/composition'
import {
  errorResponse,
  executionContext,
  jsonResponse,
  parseJsonBody,
  requestId,
  rateLimitedResponse,
  type FunctionEvent,
} from '../../src/server/transport'

export const handler: Handler = async (event) => {
  const id = requestId()
  const startedAt = Date.now()
  const limit = allowPublicRequest(event as FunctionEvent, 'plan', 5, 60_000)
  if (!limit.allowed) return rateLimitedResponse(id, limit.retryAfterSeconds)
  try {
    const plan = await createComposition().planExpedition.execute(
      parseJsonBody(event as FunctionEvent),
      executionContext(id),
    )
    console.log(
      JSON.stringify({
        requestId: id,
        operation: 'plan',
        status: 200,
        durationMs: Date.now() - startedAt,
      }),
    )
    return jsonResponse(id, plan)
  } catch (error) {
    return errorResponse(id, error)
  }
}
