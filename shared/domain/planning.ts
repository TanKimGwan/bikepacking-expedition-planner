import type {
  CanonicalLocation,
  DraftExpeditionInput,
  ExpeditionInput,
  ExpeditionPlan,
  ExpeditionStage,
  FitnessLevel,
  NormalizedRoute,
  PlanWarning,
  ProviderProvenance,
  RoutePoint,
  RouteSuitability,
  StageEffortContext,
  SurfaceBreakdown,
} from '../contracts/expedition'
import { haversineMeters, locationFromRoutePoint, pointAtDistance, sliceRoute } from './geo'

export const MAX_ROUTE_DISTANCE_METERS = 1_000_000
export const TOO_CLOSE_DISTANCE_METERS = 500
export const SETTLEMENT_CORRIDOR_METERS = 2_000
/** Stage elevation totals may differ from the route aggregate by at most 0.1 m. */
export const ELEVATION_RECONCILIATION_TOLERANCE_METERS = 0.1
export const LIGHT_STAGE_DISTANCE_RATIO = 0.75
export const EFFORT_RELATIVE_TIE_TOLERANCE_METERS = 0.1
const MAX_SETTLEMENT_TARGET_DEVIATION_METERS = 25_000
const MIN_PLAUSIBLE_ELEVATION_METERS = -1_000
const MAX_PLAUSIBLE_ELEVATION_METERS = 10_000
// ponytail: conservative route-data gate; replace with provider quality metadata when available.
const SHORT_ELEVATION_SPIKE_DISTANCE_METERS = 100
const SHORT_ELEVATION_SPIKE_DELTA_METERS = 100
const PROVIDER_ELEVATION_SENTINELS = new Set([-32_768])

export class PlanningDomainError extends Error {
  constructor(
    public readonly code: 'INVALID_INPUT' | 'ROUTE_TOO_LONG',
    message: string,
  ) {
    super(message)
    this.name = 'PlanningDomainError'
  }
}

export type ProviderRoute = {
  coordinates: number[][]
  distanceMeters?: number
  ascentMeters?: number
  descentMeters?: number
  surfaceBreakdown?: SurfaceBreakdown
}

export function normalizeRoute(
  providerRoute: ProviderRoute,
  sampleIntervalMeters = 250,
): NormalizedRoute {
  if (providerRoute.coordinates.length < 2) {
    throw new PlanningDomainError(
      'INVALID_INPUT',
      'The routing provider returned too few route points.',
    )
  }

  const geometryPoints: RoutePoint[] = []
  let distanceFromStartMeters = 0
  for (const [index, coordinate] of providerRoute.coordinates.entries()) {
    const [lng, lat, elevationMeters] = coordinate
    if (
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      lng < -180 ||
      lng > 180 ||
      lat < -90 ||
      lat > 90 ||
      (elevationMeters !== undefined && !Number.isFinite(elevationMeters))
    ) {
      throw new PlanningDomainError(
        'INVALID_INPUT',
        'The routing provider returned an invalid coordinate.',
      )
    }
    if (index > 0) {
      const previous = geometryPoints[index - 1]
      distanceFromStartMeters += haversineMeters([previous.lng, previous.lat], [lng, lat])
    }
    geometryPoints.push({ lng, lat, elevationMeters, distanceFromStartMeters })
  }

  validateElevationPlausibility(geometryPoints)

  if (!Number.isFinite(distanceFromStartMeters) || distanceFromStartMeters <= 0) {
    throw new PlanningDomainError(
      'INVALID_INPUT',
      'The routing provider returned a route with no measurable distance.',
    )
  }
  const providerDistanceMeters = providerRoute.distanceMeters
  if (
    providerDistanceMeters !== undefined &&
    (!Number.isFinite(providerDistanceMeters) || providerDistanceMeters <= 0)
  ) {
    throw new PlanningDomainError(
      'INVALID_INPUT',
      'The routing provider returned an invalid route distance.',
    )
  }
  const canonicalDistanceMeters = providerDistanceMeters ?? distanceFromStartMeters
  const allPoints =
    providerDistanceMeters === undefined
      ? geometryPoints
      : geometryPoints.map((point, index) => ({
          ...point,
          distanceFromStartMeters:
            index === geometryPoints.length - 1
              ? canonicalDistanceMeters
              : point.distanceFromStartMeters * (canonicalDistanceMeters / distanceFromStartMeters),
        }))

  const sampledPoints = [allPoints[0]]
  let nextSampleDistance = sampleIntervalMeters
  for (const point of allPoints.slice(1, -1)) {
    if (point.distanceFromStartMeters >= nextSampleDistance) {
      sampledPoints.push(point)
      nextSampleDistance = point.distanceFromStartMeters + sampleIntervalMeters
    }
  }
  const lastPoint = allPoints[allPoints.length - 1]
  if (sampledPoints[sampledPoints.length - 1] !== lastPoint) sampledPoints.push(lastPoint)

  const elevationStats = calculateElevation(allPoints)
  return {
    geometry: {
      type: 'LineString',
      coordinates: providerRoute.coordinates,
    },
    points: sampledPoints,
    elevationPoints: allPoints,
    surfaceBreakdown: providerRoute.surfaceBreakdown,
    distanceMeters: canonicalDistanceMeters,
    ascentMeters: elevationStats.hasElevation
      ? elevationStats.ascentMeters
      : (providerRoute.ascentMeters ?? 0),
    descentMeters: elevationStats.hasElevation
      ? elevationStats.descentMeters
      : (providerRoute.descentMeters ?? 0),
  }
}

export function validatePlanningLimits(input: ExpeditionInput): void {
  const straightLineDistance = haversineMeters(
    [input.start.lng, input.start.lat],
    [input.destination.lng, input.destination.lat],
  )
  if (straightLineDistance < TOO_CLOSE_DISTANCE_METERS) {
    throw new PlanningDomainError(
      'INVALID_INPUT',
      'Start and destination must be at least 500 m apart.',
    )
  }
  if (straightLineDistance > MAX_ROUTE_DISTANCE_METERS) {
    throw new PlanningDomainError(
      'ROUTE_TOO_LONG',
      'This expedition is beyond the 1,000 km MVP route limit.',
    )
  }
}

export type SettlementCandidate = CanonicalLocation

type ProjectedSettlement = {
  location: SettlementCandidate
  distanceFromStartMeters: number
  routeDistanceMeters: number
}

function projectSettlements(
  route: NormalizedRoute,
  settlements: SettlementCandidate[],
): ProjectedSettlement[] {
  return settlements.flatMap((location) => {
    let nearest: ProjectedSettlement | undefined
    for (const point of route.points) {
      const routeDistanceMeters = haversineMeters(
        [location.lng, location.lat],
        [point.lng, point.lat],
      )
      if (!nearest || routeDistanceMeters < nearest.routeDistanceMeters) {
        nearest = {
          location,
          distanceFromStartMeters: point.distanceFromStartMeters,
          routeDistanceMeters,
        }
      }
    }
    return nearest && nearest.routeDistanceMeters <= SETTLEMENT_CORRIDOR_METERS ? [nearest] : []
  })
}

function settlementRank(location: CanonicalLocation): number {
  return { city: 0, town: 1, village: 2, hamlet: 3 }[location.settlementType ?? 'village']
}

function chooseStageEndpoint(
  route: NormalizedRoute,
  projectedSettlements: ProjectedSettlement[],
  startDistanceMeters: number,
  targetDistanceMeters: number,
  finalDay: boolean,
  day: number,
  destination: CanonicalLocation,
): { location: CanonicalLocation; distanceFromStartMeters: number; usedFallback: boolean } {
  if (finalDay) {
    return {
      location: destination,
      distanceFromStartMeters: route.distanceMeters,
      usedFallback: false,
    }
  }
  const candidates = projectedSettlements
    .filter(({ distanceFromStartMeters }) => distanceFromStartMeters > startDistanceMeters + 500)
    .sort((left, right) => {
      const targetDifference =
        Math.abs(left.distanceFromStartMeters - targetDistanceMeters) -
        Math.abs(right.distanceFromStartMeters - targetDistanceMeters)
      return targetDifference || settlementRank(left.location) - settlementRank(right.location)
    })
  const best = candidates[0]
  if (
    best &&
    Math.abs(best.distanceFromStartMeters - targetDistanceMeters) <=
      MAX_SETTLEMENT_TARGET_DEVIATION_METERS
  ) {
    return {
      location: best.location,
      distanceFromStartMeters: best.distanceFromStartMeters,
      usedFallback: false,
    }
  }
  const point = pointAtDistance(route.points, targetDistanceMeters)
  return {
    location: locationFromRoutePoint(point, `Balanced route point for day ${day}`),
    distanceFromStartMeters: targetDistanceMeters,
    usedFallback: true,
  }
}

function calculateElevation(points: RoutePoint[]): {
  hasElevation: boolean
  ascentMeters: number
  descentMeters: number
} {
  let ascentMeters = 0
  let descentMeters = 0
  let hasElevation = false
  for (let index = 1; index < points.length; index += 1) {
    const previousElevation = points[index - 1].elevationMeters
    const elevation = points[index].elevationMeters
    if (previousElevation === undefined || elevation === undefined) continue
    hasElevation = true
    const delta = elevation - previousElevation
    if (delta > 0) ascentMeters += delta
    if (delta < 0) descentMeters -= delta
  }
  return { hasElevation, ascentMeters, descentMeters }
}

export function routeSuitabilityFor(
  bikeType: ExpeditionInput['bikeType'],
  routeProfile: ExpeditionInput['routeProfile'],
): RouteSuitability {
  if (bikeType === 'road' && routeProfile === 'mixed-surface') {
    return {
      level: 'caution',
      code: 'ROAD_BIKE_MIXED_SURFACE',
      title: 'Road bike on mixed surface',
      message:
        'Check tire width and surface conditions before setting out; the route provider does not guarantee pavement.',
    }
  }
  return { level: 'compatible' }
}

function validateElevationPlausibility(points: RoutePoint[]): void {
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const elevation = point.elevationMeters
    if (elevation === undefined) continue
    if (
      PROVIDER_ELEVATION_SENTINELS.has(elevation) ||
      elevation < MIN_PLAUSIBLE_ELEVATION_METERS ||
      elevation > MAX_PLAUSIBLE_ELEVATION_METERS
    ) {
      throw new PlanningDomainError(
        'INVALID_INPUT',
        'The routing provider returned implausible elevation data.',
      )
    }

    const previous = points[index - 1]?.elevationMeters
    if (previous === undefined) continue
    const horizontalDistance = haversineMeters(
      [points[index - 1].lng, points[index - 1].lat],
      [point.lng, point.lat],
    )
    if (
      horizontalDistance < SHORT_ELEVATION_SPIKE_DISTANCE_METERS &&
      Math.abs(elevation - previous) > SHORT_ELEVATION_SPIKE_DELTA_METERS
    ) {
      throw new PlanningDomainError(
        'INVALID_INPUT',
        'The routing provider returned implausible elevation data.',
      )
    }
  }
}

function stageElevation(
  route: NormalizedRoute,
  startDistanceMeters: number,
  endDistanceMeters: number,
) {
  const elevationPoints = route.elevationPoints ?? route.points
  const points = [
    pointAtDistance(elevationPoints, startDistanceMeters),
    ...elevationPoints.filter(
      (point) =>
        point.distanceFromStartMeters > startDistanceMeters &&
        point.distanceFromStartMeters < endDistanceMeters,
    ),
    pointAtDistance(elevationPoints, endDistanceMeters),
  ]
  const stats = calculateElevation(points)
  return { ascentMeters: stats.ascentMeters, descentMeters: stats.descentMeters }
}

const SPEEDS_KPH: Record<
  FitnessLevel,
  { paved: number; mixed: number; comfortableDailyDistance: number }
> = {
  beginner: { paved: 14, mixed: 12, comfortableDailyDistance: 80_000 },
  intermediate: { paved: 18, mixed: 16, comfortableDailyDistance: 120_000 },
  experienced: { paved: 22, mixed: 20, comfortableDailyDistance: 160_000 },
}

function withStageEffortContext(
  stages: ExpeditionStage[],
  fitness: FitnessLevel,
): ExpeditionStage[] {
  const comfortableDailyDistance = SPEEDS_KPH[fitness].comfortableDailyDistance
  const longestDistance = Math.max(...stages.map((stage) => stage.distanceMeters))
  const mostClimbing = Math.max(...stages.map((stage) => stage.ascentMeters))

  return stages.map((stage) => {
    const distanceRatio = stage.distanceMeters / comfortableDailyDistance
    const climbingDensity = (stage.ascentMeters / stage.distanceMeters) * 1_000
    const relativeLabels: StageEffortContext['relativeLabels'] = []
    if (Math.abs(stage.distanceMeters - longestDistance) <= EFFORT_RELATIVE_TIE_TOLERANCE_METERS) {
      relativeLabels.push('longest-stage')
    }
    if (Math.abs(stage.ascentMeters - mostClimbing) <= EFFORT_RELATIVE_TIE_TOLERANCE_METERS) {
      relativeLabels.push('most-climbing')
    }

    return {
      ...stage,
      effort: {
        distanceLevel:
          distanceRatio <= LIGHT_STAGE_DISTANCE_RATIO
            ? 'light'
            : distanceRatio <= 1
              ? 'moderate'
              : 'demanding',
        climbingLevel:
          climbingDensity < 5 ? 'low' : climbingDensity < 10 ? 'rolling' : 'climbing-heavy',
        relativeLabels,
      },
    }
  })
}

export function estimatedRidingTimeSeconds(
  distanceMeters: number,
  fitness: FitnessLevel,
  routeProfile: ExpeditionInput['routeProfile'],
): number {
  const speedKph = SPEEDS_KPH[fitness][routeProfile === 'mixed-surface' ? 'mixed' : 'paved']
  return (distanceMeters / 1_000 / speedKph) * 3_600
}

export function tripDraftMatchesInput(
  draft: DraftExpeditionInput,
  input: ExpeditionInput,
): boolean {
  return Boolean(
    draft.start &&
    draft.destination &&
    draft.start.lat === input.start.lat &&
    draft.start.lng === input.start.lng &&
    draft.destination.lat === input.destination.lat &&
    draft.destination.lng === input.destination.lng &&
    draft.days === input.days &&
    draft.bikeType === input.bikeType &&
    draft.routeProfile === input.routeProfile &&
    draft.fitness === input.fitness,
  )
}

export function recommendedDaysFor(
  distanceMeters: number,
  currentDays: number,
  fitness: FitnessLevel,
): number | undefined {
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters <= 0 ||
    !Number.isInteger(currentDays) ||
    currentDays < 2 ||
    currentDays > 7
  ) {
    return undefined
  }
  const pace = SPEEDS_KPH[fitness]
  if (!pace) return undefined
  const comfortableDailyDistance = pace.comfortableDailyDistance
  if (distanceMeters / currentDays <= comfortableDailyDistance) return undefined
  for (let days = currentDays + 1; days <= 7; days += 1) {
    if (distanceMeters / days <= comfortableDailyDistance) return days
  }
  return undefined
}

export function buildExpeditionPlan(
  input: ExpeditionInput,
  route: NormalizedRoute,
  settlements: SettlementCandidate[],
  provenance: ProviderProvenance,
): ExpeditionPlan {
  if (route.distanceMeters > MAX_ROUTE_DISTANCE_METERS) {
    throw new PlanningDomainError(
      'ROUTE_TOO_LONG',
      'The routed distance is beyond the 1,000 km MVP limit.',
    )
  }

  const projectedSettlements = projectSettlements(route, settlements)
  const stages: ExpeditionStage[] = []
  const warnings: PlanWarning[] = []
  let startDistanceMeters = 0
  let startLocation = input.start

  for (let day = 1; day <= input.days; day += 1) {
    const remainingDays = input.days - day + 1
    const targetDistanceMeters =
      startDistanceMeters + (route.distanceMeters - startDistanceMeters) / remainingDays
    const endpoint = chooseStageEndpoint(
      route,
      projectedSettlements,
      startDistanceMeters,
      targetDistanceMeters,
      day === input.days,
      day,
      input.destination,
    )
    const distanceMeters = endpoint.distanceFromStartMeters - startDistanceMeters
    const elevation = stageElevation(route, startDistanceMeters, endpoint.distanceFromStartMeters)
    stages.push({
      day,
      startDistanceMeters,
      endDistanceMeters: endpoint.distanceFromStartMeters,
      geometry: sliceRoute(route, startDistanceMeters, endpoint.distanceFromStartMeters),
      distanceMeters,
      ascentMeters: elevation.ascentMeters,
      descentMeters: elevation.descentMeters,
      start: startLocation,
      end: endpoint.location,
      estimatedRidingTimeSeconds: estimatedRidingTimeSeconds(
        distanceMeters,
        input.fitness,
        input.routeProfile,
      ),
    })
    if (endpoint.usedFallback) {
      warnings.push({
        code: `NO_SETTLEMENT_DAY_${day}`,
        severity: 'info',
        title: `Day ${day} ends at a route point`,
        message:
          'No suitable settlement was found close enough to the target, so this stage uses the balanced route point.',
      })
    }
    startDistanceMeters = endpoint.distanceFromStartMeters
    startLocation = endpoint.location
  }

  const pace = SPEEDS_KPH[input.fitness]
  const stagesWithEffort = withStageEffortContext(stages, input.fitness)
  const averageDistanceMeters = route.distanceMeters / input.days
  const demanding = averageDistanceMeters > pace.comfortableDailyDistance
  const recommendedDays = demanding
    ? recommendedDaysFor(route.distanceMeters, input.days, input.fitness)
    : undefined
  const feasibility = {
    level: demanding ? ('demanding' as const) : ('comfortable' as const),
    title: demanding ? 'A demanding daily rhythm' : 'A manageable daily rhythm',
    message: demanding
      ? `At ${formatKilometers(averageDistanceMeters)} per day, this plan is above the usual comfortable range for a ${input.fitness} rider.`
      : `At ${formatKilometers(averageDistanceMeters)} per day, this plan stays within a reasonable range for a ${input.fitness} rider.`,
    averageDistanceMeters,
    recommendedDailyDistanceMeters: pace.comfortableDailyDistance,
    recommendedDays,
  }
  if (demanding) {
    warnings.unshift({
      code: 'DEMANDING_DAILY_DISTANCE',
      severity: 'warning',
      title: 'Plan the recovery, not just the miles',
      message: feasibility.message,
    })
  }
  const suitability = routeSuitabilityFor(input.bikeType, input.routeProfile)
  if (suitability.level === 'caution') {
    warnings.push({
      code: 'ROAD_BIKE_MIXED_SURFACE',
      severity: 'warning',
      title: suitability.title,
      message: suitability.message,
    })
  }

  return {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    input,
    route,
    stages: stagesWithEffort,
    summary: {
      totalDistanceMeters: route.distanceMeters,
      totalAscentMeters: route.ascentMeters,
      days: input.days,
      averageDistanceMeters,
      estimatedTotalRidingTimeSeconds: stages.reduce(
        (total, stage) => total + stage.estimatedRidingTimeSeconds,
        0,
      ),
    },
    feasibility,
    suitability,
    warnings,
    provenance,
  }
}

function formatKilometers(meters: number): string {
  return `${Math.round(meters / 1_000)} km`
}
