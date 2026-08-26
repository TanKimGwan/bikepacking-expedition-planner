import type { FunctionEvent } from './transport'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 2_048

function header(event: FunctionEvent, name: string): string | undefined {
  const entry = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === name)
  return entry?.[1]
}

function clientKey(event: FunctionEvent): string {
  const address =
    header(event, 'x-nf-client-connection-ip') ?? header(event, 'x-forwarded-for')?.split(',')[0]
  return address?.trim() || 'anonymous'
}

export function allowPublicRequest(
  event: FunctionEvent,
  scope: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const key = `${scope}:${clientKey(event)}`
  const current = buckets.get(key)
  if (!current || current.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear()
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    }
  }
  current.count += 1
  return { allowed: true, retryAfterSeconds: 0 }
}
