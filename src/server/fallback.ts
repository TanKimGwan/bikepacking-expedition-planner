import fallbackPlans from './fallback-plans.json'

import {
  ExpeditionPlanSchema,
  type ExpeditionInput,
  type ExpeditionPlan,
} from '@shared/contracts/expedition'
import { haversineMeters } from '@shared/domain/geo'
import { buildExpeditionPlan, normalizeRoute } from '@shared/domain/planning'

const CURATED_ROUTES = [
  { start: [37.7749, -122.4194], destination: [36.9741, -122.0308] },
  { start: [52.3676, 4.9041], destination: [50.8503, 4.3517] },
  { start: [-6.9175, 107.6191], destination: [-7.6907, 108.353] },
] as const

function curatedRouteFor(input: ExpeditionInput) {
  return CURATED_ROUTES.find(
    (route) =>
      haversineMeters([input.start.lng, input.start.lat], [route.start[1], route.start[0]]) <
        3_000 &&
      haversineMeters(
        [input.destination.lng, input.destination.lat],
        [route.destination[1], route.destination[0]],
      ) < 3_000,
  )
}

export function cachedPlanFor(input: ExpeditionInput): ExpeditionPlan | null {
  if (!curatedRouteFor(input)) return null
  const parsed = (fallbackPlans as unknown[])
    .map((value) => ExpeditionPlanSchema.safeParse(value))
    .find(
      (result) =>
        result.success &&
        haversineMeters(
          [input.start.lng, input.start.lat],
          [result.data.input.start.lng, result.data.input.start.lat],
        ) < 3_000 &&
        haversineMeters(
          [input.destination.lng, input.destination.lat],
          [result.data.input.destination.lng, result.data.input.destination.lat],
        ) < 3_000,
    )
  if (!parsed?.success) return null
  const template = parsed.data
  const route = normalizeRoute({
    coordinates: template.route.geometry.coordinates,
    ascentMeters: template.route.ascentMeters,
    descentMeters: template.route.descentMeters,
  })
  const replanned = buildExpeditionPlan(
    input,
    route,
    template.stages
      .slice(0, -1)
      .map((stage) =>
        stage.end.id.startsWith('route-point:')
          ? { ...stage.end, label: `Balanced route point for day ${stage.day}` }
          : stage.end,
      ),
    { ...template.provenance, source: 'cached' },
  )
  return {
    ...replanned,
    warnings: [
      ...replanned.warnings,
      {
        code: 'CACHED_DEMO_FALLBACK',
        severity: 'info',
        title: 'Showing the curated route backup',
        message:
          'Live route services were unavailable, so this known demo route is using a cached result created by the live planning pipeline.',
      },
    ],
  }
}
