import { get, set } from 'idb-keyval'

import { ExpeditionPlanSchema, type ExpeditionPlan } from '@shared/contracts/expedition'

const CURRENT_PLAN_KEY = 'current-expedition:v1'

export async function saveCurrentPlan(plan: ExpeditionPlan): Promise<void> {
  await set(CURRENT_PLAN_KEY, plan)
}

export async function loadCurrentPlan(): Promise<ExpeditionPlan | null> {
  const value = await get<unknown>(CURRENT_PLAN_KEY)
  const parsed = ExpeditionPlanSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
