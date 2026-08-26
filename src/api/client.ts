import { z } from 'zod'

import { ApiErrorPayloadSchema, type ApiErrorPayload } from '@shared/contracts/expedition'

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError(
      'UNKNOWN_ERROR',
      'The server returned an unreadable response.',
      true,
      response.status,
    )
  }
  if (!response.ok) {
    const error = ApiErrorPayloadSchema.safeParse(payload)
    const fallback: ApiErrorPayload = {
      code: 'UNKNOWN_ERROR',
      message: 'The request failed.',
      retryable: true,
    }
    const detail = error.success ? error.data : fallback
    throw new ApiError(
      detail.code,
      detail.message,
      detail.retryable,
      response.status,
      detail.requestId,
    )
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success)
    throw new ApiError(
      'PROVIDER_RESPONSE_INVALID',
      'The server returned an invalid plan.',
      false,
      response.status,
    )
  return parsed.data
}

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: controller.signal,
    })
    return await parseResponse(response, schema)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(
        'PROVIDER_TIMEOUT',
        'The request timed out. Try again when the connection is steadier.',
        true,
      )
    }
    throw new ApiError('UNKNOWN_ERROR', 'The planner could not reach its route service.', true)
  } finally {
    clearTimeout(timeout)
  }
}
