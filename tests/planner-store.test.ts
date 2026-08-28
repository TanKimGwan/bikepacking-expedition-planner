import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { PRESETS } from '@/application/presets'
import { loadCurrentPlan, saveCurrentPlan } from '@/application/persistence'
import { generatePlan } from '@/api/expedition-api'
import { usePlannerStore } from '@/stores/planner'
import { cachedPlanFor } from '@/server/fallback'
import { ExpeditionInputSchema } from '@shared/contracts/expedition'

vi.mock('@/application/persistence', () => ({
  loadCurrentPlan: vi.fn(),
  saveCurrentPlan: vi.fn(),
}))
vi.mock('@/api/expedition-api', () => ({ generatePlan: vi.fn() }))

const loadCurrentPlanMock = vi.mocked(loadCurrentPlan)
const saveCurrentPlanMock = vi.mocked(saveCurrentPlan)
const generatePlanMock = vi.mocked(generatePlan)
const localStorageMock = { getItem: vi.fn(() => null), setItem: vi.fn() }
const plan = cachedPlanFor(ExpeditionInputSchema.parse(PRESETS['sf-santa-cruz'].input))

if (!plan) throw new Error('Expected the curated fixture plan.')

describe('planner store persistence boundaries', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', localStorageMock)
    loadCurrentPlanMock.mockResolvedValue(null)
    saveCurrentPlanMock.mockResolvedValue()
    generatePlanMock.mockResolvedValue(plan)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps a generated plan successful when persistence rejects', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    saveCurrentPlanMock.mockRejectedValueOnce(new Error('IndexedDB unavailable'))
    const store = usePlannerStore()
    store.setDraft(PRESETS['sf-santa-cruz'].input)

    await store.generate()

    expect(store.status).toBe('success')
    expect(store.currentPlan?.id).toBe(plan.id)
    expect(store.error).toBeNull()
    expect(warning).toHaveBeenCalledWith(
      'Planner plan persistence failed; keeping the generated plan in memory.',
    )
  })

  it('resolves restore safely without a stale plan when storage rejects', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    loadCurrentPlanMock.mockRejectedValueOnce(new Error('IndexedDB unavailable'))
    const store = usePlannerStore()

    await expect(store.restore()).resolves.toBeUndefined()

    expect(store.currentPlan).toBeNull()
    expect(store.status).toBe('idle')
    expect(warning).toHaveBeenCalledWith(
      'Planner plan restore failed; starting without a saved plan.',
    )
  })
})
