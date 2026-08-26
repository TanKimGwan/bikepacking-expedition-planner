import type {
  CanonicalLocation,
  ExpeditionInput,
  ExpeditionPlan,
  ExpeditionStage,
  FitnessLevel,
  NormalizedRoute,
  PlanWarning,
  ProviderProvenance,
  RoutePoint,
} from '../contracts/expedition'
import { haversineMeters, locationFromRoutePoint, pointAtDistance, sliceRoute } from './geo'

export const MAX_ROUTE_DISTANCE_METERS = 1_000_000
export const TOO_CLOSE_DISTANCE_METERS = 500
export const SETTLEMENT_CORRIDOR_METERS = 2_000
/** Stage elevation totals may differ from the route aggregate by at most 0.1 m. */
export const ELEVATION_RECONCILIATION_TOLERANCE_METERS = 0.1
const MAX_SETTLEMENT_TARGET_DEVIATION_METERS = 25_000

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

  const allPoints: RoutePoint[] = []
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
      const previous = allPoints[index - 1]
      distanceFromStartMeters += haversineMeters([previous.lng, previous.lat], [lng, lat])
    }
    allPoints.push({ lng, lat, elevationMeters, distanceFromStartMeters })
  }

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
    distanceMeters: distanceFromStartMeters,
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

export function estimatedRidingTimeSeconds(
  distanceMeters: number,
  fitness: FitnessLevel,
  routeProfile: ExpeditionInput['routeProfile'],
): number {
  const speedKph = SPEEDS_KPH[fitness][routeProfile === 'mixed-surface' ? 'mixed' : 'paved']
  return (distanceMeters / 1_000 / speedKph) * 3_600
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
  const averageDistanceMeters = route.distanceMeters / input.days
  const demanding = averageDistanceMeters > pace.comfortableDailyDistance
  const feasibility = {
    level: demanding ? ('demanding' as const) : ('comfortable' as const),
    title: demanding ? 'A demanding daily rhythm' : 'A manageable daily rhythm',
    message: demanding
      ? `At ${formatKilometers(averageDistanceMeters)} per day, this plan is above the usual comfortable range for a ${input.fitness} rider.`
      : `At ${formatKilometers(averageDistanceMeters)} per day, this plan stays within a reasonable range for a ${input.fitness} rider.`,
    averageDistanceMeters,
    recommendedDailyDistanceMeters: pace.comfortableDailyDistance,
  }
  if (demanding) {
    warnings.unshift({
      code: 'DEMANDING_DAILY_DISTANCE',
      severity: 'warning',
      title: 'Plan the recovery, not just the miles',
      message: feasibility.message,
    })
  }
  if (input.bikeType === 'road' && input.routeProfile === 'mixed-surface') {
    warnings.push({
      code: 'ROAD_BIKE_MIXED_SURFACE',
      severity: 'warning',
      title: 'Road bike on mixed surface',
      message:
        'Check tire width and surface conditions before setting out; the route provider does not guarantee pavement.',
    })
  }

  return {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    input,
    route,
    stages,
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
    warnings,
    provenance,
  }
}

function formatKilometers(meters: number): string {
  return `${Math.round(meters / 1_000)} km`
}
