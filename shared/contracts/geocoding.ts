import { z } from 'zod'

import { CanonicalLocationSchema } from './expedition'

export const LocationSearchResponseSchema = z.array(CanonicalLocationSchema)
export type LocationSearchResponse = z.infer<typeof LocationSearchResponseSchema>
