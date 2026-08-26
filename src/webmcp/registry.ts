import { ExpeditionInputSchema, type ExpeditionInput } from '@shared/contracts/expedition'

import { searchLocations } from '@/api/geocoding-api'
import { usePlannerStore } from '@/stores/planner'

type ToolExecutionOptions = { signal?: AbortSignal }
type ToolRegistration = void | (() => void) | { unregister?: () => void }

type ToolContext = {
  registerTool: (tool: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: { readOnlyHint?: boolean }
    execute: (input: unknown, options?: ToolExecutionOptions) => Promise<unknown>
  }) => ToolRegistration | Promise<ToolRegistration>
}

function toolError(code: string, message: string) {
  return { status: 'error', error: { code, message } }
}

function planProjection(store: ReturnType<typeof usePlannerStore>) {
  const plan = store.currentPlan
  if (!plan) return toolError('PLAN_NOT_READY', 'Generate an expedition plan before inspecting it.')
  return {
    status: 'success',
    planId: plan.id,
    input: plan.input,
    summary: plan.summary,
    stages: plan.stages.map((stage) => ({
      day: stage.day,
      start: stage.start.label,
      end: stage.end.label,
      distanceMeters: stage.distanceMeters,
      ascentMeters: stage.ascentMeters,
      estimatedRidingTimeSeconds: stage.estimatedRidingTimeSeconds,
    })),
    feasibility: plan.feasibility,
    warnings: plan.warnings,
    provenance: plan.provenance,
  }
}

export function registerWebMcp(store: ReturnType<typeof usePlannerStore>): boolean {
  const modelContext = (document as Document & { modelContext?: ToolContext }).modelContext
  if (!modelContext?.registerTool) {
    store.setWebMcpAvailability(false)
    return false
  }
  const locationSchema = {
    type: 'object',
    required: ['id', 'label', 'lat', 'lng'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      lat: { type: 'number' },
      lng: { type: 'number' },
    },
  }
  modelContext.registerTool({
    name: 'search_locations',
    description: 'Search for canonical start or destination locations.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', minLength: 3 } },
    },
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const query =
        typeof input === 'object' && input !== null && 'query' in input ? input.query : undefined
      if (typeof query !== 'string' || query.trim().length < 3 || query.trim().length > 160)
        return toolError('INVALID_INPUT', 'Query must contain at least 3 characters.')
      try {
        return { status: 'success', locations: await searchLocations(query.trim()) }
      } catch {
        return toolError('LOCATION_SEARCH_FAILED', 'Location search is temporarily unavailable.')
      }
    },
  })
  modelContext.registerTool({
    name: 'set_trip_parameters',
    description:
      'Atomically set the start, destination, duration, bike, route profile, and fitness.',
    inputSchema: {
      type: 'object',
      required: ['start', 'destination', 'days', 'bikeType', 'routeProfile', 'fitness'],
      properties: {
        start: locationSchema,
        destination: locationSchema,
        days: { type: 'integer', minimum: 2, maximum: 7 },
        bikeType: { type: 'string' },
        routeProfile: { type: 'string' },
        fitness: { type: 'string' },
      },
    },
    execute: async (input) => {
      const parsed = ExpeditionInputSchema.safeParse(input)
      if (!parsed.success)
        return toolError('INVALID_INPUT', 'Trip parameters do not match the planner contract.')
      store.setDraft(parsed.data as ExpeditionInput)
      return { status: 'success', input: parsed.data }
    },
  })
  modelContext.registerTool({
    name: 'generate_expedition_plan',
    description:
      'Generate the current expedition plan using the same planning action as the human Generate button.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      if (store.status === 'planning') {
        return toolError('PLAN_IN_PROGRESS', 'An expedition plan is already being generated.')
      }
      await store.generate()
      if (store.error) return toolError(store.error.code, store.error.message)
      return {
        status: 'success',
        planId: store.currentPlan?.id,
        summary: store.currentPlan?.summary,
        warnings: store.currentPlan?.warnings ?? [],
      }
    },
  })
  modelContext.registerTool({
    name: 'get_expedition_plan',
    description:
      'Return a compact structured projection of the current expedition plan without raw route coordinates.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => planProjection(store),
  })
  store.setWebMcpAvailability(true)
  return true
}
