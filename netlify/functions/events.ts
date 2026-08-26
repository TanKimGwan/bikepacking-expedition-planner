import type { Handler } from '@netlify/functions'

export const handler: Handler = async () => ({
  statusCode: 204,
  headers: { 'Cache-Control': 'no-store' },
})
