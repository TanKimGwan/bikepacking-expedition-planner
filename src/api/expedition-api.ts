import {
  ExpeditionPlanSchema,
  type ExpeditionInput,
  type ExpeditionPlan,
} from '@shared/contracts/expedition'

import { apiRequest } from './client'

export function generatePlan(input: ExpeditionInput): Promise<ExpeditionPlan> {
  return apiRequest('/api/plan', ExpeditionPlanSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
