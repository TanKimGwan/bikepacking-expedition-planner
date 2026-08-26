import { ApplicationError, isApplicationError, type StableErrorCode } from './errors'
import type { ExecutionContext } from './network'

export type FunctionEvent = {
  body?: string | null
  isBase64Encoded?: boolean
  headers: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined> | null
  rawQuery?: string
}

export type FunctionResponse = {
  statusCode: number
  headers?: Record<string, string>
  body?: string
}

const HTTP_STATUS: Record<StableErrorCode, number> = {
  INVALID_INPUT: 400,
  ROUTE_TOO_LONG: 400,
  ROUTE_NOT_FOUND: 422,
  ROUTING_FAILED: 502,
  ELEVATION_FAILED: 502,
  SETTLEMENT_LOOKUP_FAILED: 502,
  PROVIDER_RESPONSE_INVALID: 502,
  PROVIDER_TIMEOUT: 504,
  RATE_LIMITED: 429,
  UNKNOWN_ERROR: 500,
}

export function requestId(): string {
  return crypto.randomUUID()
}

export function executionContext(id: string, budgetMs = 20_000): ExecutionContext {
  return { requestId: id, signal: new AbortController().signal, deadlineAt: Date.now() + budgetMs }
}

export function parseJsonBody(event: FunctionEvent): unknown {
  if (!event.body) return undefined
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body
  if (Buffer.byteLength(body, 'utf8') > 32_768)
    throw new ApplicationError('INVALID_INPUT', 'Request body is too large.')
  try {
    return JSON.parse(body)
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'Request body must be valid JSON.')
  }
}

export function jsonResponse(
  request: string,
  payload: unknown,
  statusCode = 200,
): FunctionResponse {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-ID': request,
    },
    body: JSON.stringify(payload),
  }
}

export function rateLimitedResponse(request: string, retryAfterSeconds: number): FunctionResponse {
  const response = jsonResponse(
    request,
    {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again shortly.',
      retryable: true,
      requestId: request,
    },
    429,
  )
  return {
    ...response,
    headers: {
      ...response.headers,
      'Retry-After': String(retryAfterSeconds),
    },
  }
}

export function errorResponse(request: string, error: unknown): FunctionResponse {
  const applicationError = isApplicationError(error)
    ? error
    : new ApplicationError('UNKNOWN_ERROR', 'The request could not be completed.')
  console.error(
    JSON.stringify({
      requestId: request,
      code: applicationError.code,
      retryable: applicationError.retryable,
    }),
  )
  return jsonResponse(
    request,
    {
      code: applicationError.code,
      message: applicationError.message,
      retryable: applicationError.retryable,
      requestId: request,
    },
    HTTP_STATUS[applicationError.code],
  )
}

export function queryValue(event: FunctionEvent, name: string): string | undefined {
  const value = event.queryStringParameters?.[name]
  if (value) return value
  if (!event.rawQuery) return undefined
  return new URLSearchParams(event.rawQuery).get(name) ?? undefined
}
