import { z } from 'zod'

import { ApplicationError, type StableErrorCode } from './errors'

export type ExecutionContext = {
  requestId: string
  signal: AbortSignal
  deadlineAt: number
}

type FetchJsonOptions = {
  timeoutMs: number
  failureCode: StableErrorCode
  notFoundCode?: StableErrorCode
  provider: string
}

function canRetry(error: ApplicationError): boolean {
  return error.retryable && error.code !== 'PROVIDER_RESPONSE_INVALID'
}

export async function fetchJson<T>(
  context: ExecutionContext,
  url: string | URL,
  init: RequestInit,
  schema: z.ZodType<T>,
  options: FetchJsonOptions,
): Promise<T> {
  let attempt = 0
  while (true) {
    const remainingMs = context.deadlineAt - Date.now()
    if (remainingMs <= 0 || context.signal.aborted) {
      throw new ApplicationError(
        'PROVIDER_TIMEOUT',
        `${options.provider} request exceeded the planning deadline.`,
        true,
      )
    }
    const controller = new AbortController()
    const abortFromContext = () => controller.abort()
    context.signal.addEventListener('abort', abortFromContext, { once: true })
    const timeoutMs = Math.min(options.timeoutMs, Math.max(1, remainingMs))
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      const body = await response.text()
      if (!response.ok) {
        const retryable =
          response.status === 408 || response.status === 429 || response.status >= 500
        const code =
          response.status === 404 && options.notFoundCode
            ? options.notFoundCode
            : options.failureCode
        throw new ApplicationError(
          code,
          `${options.provider} request failed.`,
          retryable,
          response.status,
        )
      }
      let payload: unknown
      try {
        payload = JSON.parse(body)
      } catch {
        throw new ApplicationError(
          'PROVIDER_RESPONSE_INVALID',
          `${options.provider} returned invalid JSON.`,
        )
      }
      const parsed = schema.safeParse(payload)
      if (!parsed.success) {
        throw new ApplicationError(
          'PROVIDER_RESPONSE_INVALID',
          `${options.provider} returned an unexpected response.`,
        )
      }
      return parsed.data
    } catch (error) {
      const applicationError =
        error instanceof ApplicationError
          ? error
          : error instanceof DOMException && error.name === 'AbortError'
            ? new ApplicationError(
                'PROVIDER_TIMEOUT',
                `${options.provider} request timed out.`,
                true,
              )
            : new ApplicationError(
                options.failureCode,
                `${options.provider} request could not be completed.`,
                true,
              )
      const hasBudgetForRetry = context.deadlineAt - Date.now() > Math.min(options.timeoutMs, 1_000)
      if (
        attempt < 1 &&
        canRetry(applicationError) &&
        hasBudgetForRetry &&
        !context.signal.aborted
      ) {
        attempt += 1
        continue
      }
      throw applicationError
    } finally {
      clearTimeout(timeout)
      context.signal.removeEventListener('abort', abortFromContext)
    }
  }
}
