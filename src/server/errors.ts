export type StableErrorCode =
  | 'INVALID_INPUT'
  | 'ROUTE_NOT_FOUND'
  | 'ROUTING_FAILED'
  | 'ELEVATION_FAILED'
  | 'SETTLEMENT_LOOKUP_FAILED'
  | 'ROUTE_TOO_LONG'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RESPONSE_INVALID'
  | 'RATE_LIMITED'
  | 'UNKNOWN_ERROR'

export class ApplicationError extends Error {
  constructor(
    public readonly code: StableErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ApplicationError'
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError
}
