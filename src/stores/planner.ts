import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  DraftExpeditionInputSchema,
  ExpeditionInputSchema,
  type CanonicalLocation,
  type DraftExpeditionInput,
  type ExpeditionPlan,
} from '@shared/contracts/expedition'

import { ApiError } from '@/api/client'
import { generatePlan } from '@/api/expedition-api'
import { loadCurrentPlan, saveCurrentPlan } from '@/application/persistence'

export type PlanningStatus = 'idle' | 'planning' | 'success' | 'error'
export type UnitSystem = 'metric' | 'imperial'

export const usePlannerStore = defineStore('planner', () => {
  const status = ref<PlanningStatus>('idle')
  const draftInput = ref<DraftExpeditionInput>({
    days: 3,
    bikeType: 'gravel',
    routeProfile: 'paved-priority',
    fitness: 'intermediate',
  })
  const currentPlan = ref<ExpeditionPlan | null>(null)
  const error = ref<ApiError | null>(null)
  const selectedStageDay = ref<number | null>(null)
  const unitSystem = ref<UnitSystem>(
    (localStorage.getItem('waypoint:units') as UnitSystem | null) ?? 'metric',
  )
  const webMcpAvailable = ref(false)

  const hasLocations = computed(() =>
    Boolean(draftInput.value.start && draftInput.value.destination),
  )
  const canGenerate = computed(() => ExpeditionInputSchema.safeParse(draftInput.value).success)

  function setDraft(patch: DraftExpeditionInput) {
    draftInput.value = { ...draftInput.value, ...patch }
  }

  function setLocation(field: 'start' | 'destination', location: CanonicalLocation) {
    setDraft({ [field]: location })
  }

  function setUnits(units: UnitSystem) {
    unitSystem.value = units
    localStorage.setItem('waypoint:units', units)
  }

  async function restore() {
    const savedPlan = await loadCurrentPlan()
    if (!savedPlan) return
    const draftMatchesSavedPlan =
      draftInput.value.start?.lat === savedPlan.input.start.lat &&
      draftInput.value.start?.lng === savedPlan.input.start.lng &&
      draftInput.value.destination?.lat === savedPlan.input.destination.lat &&
      draftInput.value.destination?.lng === savedPlan.input.destination.lng &&
      draftInput.value.days === savedPlan.input.days &&
      draftInput.value.bikeType === savedPlan.input.bikeType &&
      draftInput.value.routeProfile === savedPlan.input.routeProfile &&
      draftInput.value.fitness === savedPlan.input.fitness
    if ((draftInput.value.start || draftInput.value.destination) && !draftMatchesSavedPlan) return
    currentPlan.value = savedPlan
    if (!draftMatchesSavedPlan) draftInput.value = { ...savedPlan.input }
    status.value = 'success'
  }

  async function generate() {
    if (status.value === 'planning') return
    error.value = null
    const parsed = ExpeditionInputSchema.safeParse(draftInput.value)
    if (!parsed.success) {
      error.value = new ApiError(
        'INVALID_INPUT',
        'Choose a start, destination, duration, bike, route, and fitness level.',
        false,
        400,
      )
      status.value = 'error'
      return
    }
    status.value = 'planning'
    try {
      const plan = await generatePlan(parsed.data)
      currentPlan.value = plan
      status.value = 'success'
      selectedStageDay.value = null
      await saveCurrentPlan(plan)
    } catch (caught) {
      error.value =
        caught instanceof ApiError
          ? caught
          : new ApiError('UNKNOWN_ERROR', 'The plan could not be generated.', true)
      status.value = 'error'
    }
  }

  function selectStage(day: number | null) {
    selectedStageDay.value = day
  }

  function setWebMcpAvailability(available: boolean) {
    webMcpAvailable.value = available
  }

  return {
    status,
    draftInput,
    currentPlan,
    error,
    selectedStageDay,
    unitSystem,
    webMcpAvailable,
    hasLocations,
    canGenerate,
    setDraft,
    setLocation,
    setUnits,
    restore,
    generate,
    selectStage,
    setWebMcpAvailability,
  }
})

export function draftFromUnknown(value: unknown): DraftExpeditionInput {
  const parsed = DraftExpeditionInputSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}
