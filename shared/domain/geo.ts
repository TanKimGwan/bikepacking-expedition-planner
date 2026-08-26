import type {
  CanonicalLocation,
  LineString,
  NormalizedRoute,
  RoutePoint,
} from '../contracts/expedition'

const EARTH_RADIUS_METERS = 6_371_008.8

export function haversineMeters(from: [number, number], to: [number, number]): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = toRadians(to[1] - from[1])
  const longitudeDelta = toRadians(to[0] - from[0])
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from[1])) * Math.cos(toRadians(to[1])) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function interpolatePoint(from: RoutePoint, to: RoutePoint, distance: number): RoutePoint {
  const span = to.distanceFromStartMeters - from.distanceFromStartMeters
  const ratio =
    span === 0 ? 0 : Math.min(1, Math.max(0, (distance - from.distanceFromStartMeters) / span))
  const elevation =
    from.elevationMeters === undefined || to.elevationMeters === undefined
      ? undefined
      : from.elevationMeters + (to.elevationMeters - from.elevationMeters) * ratio
  return {
    lng: from.lng + (to.lng - from.lng) * ratio,
    lat: from.lat + (to.lat - from.lat) * ratio,
    elevationMeters: elevation,
    distanceFromStartMeters: distance,
  }
}

export function pointAtDistance(points: RoutePoint[], distance: number): RoutePoint {
  if (distance <= 0) return { ...points[0], distanceFromStartMeters: 0 }
  const last = points[points.length - 1]
  if (distance >= last.distanceFromStartMeters) return { ...last }
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].distanceFromStartMeters >= distance) {
      return interpolatePoint(points[index - 1], points[index], distance)
    }
  }
  return { ...last }
}

export function sliceRoute(
  route: NormalizedRoute,
  startDistance: number,
  endDistance: number,
): LineString {
  const start = Math.max(0, startDistance)
  const end = Math.min(route.distanceMeters, Math.max(start, endDistance))
  const routePoints = route.elevationPoints ?? route.points
  const points = [pointAtDistance(routePoints, start)]
  points.push(
    ...routePoints.filter(
      (point) => point.distanceFromStartMeters > start && point.distanceFromStartMeters < end,
    ),
  )
  points.push(pointAtDistance(routePoints, end))
  return {
    type: 'LineString',
    coordinates: points.map((point) => [
      point.lng,
      point.lat,
      ...(point.elevationMeters === undefined ? [] : [point.elevationMeters]),
    ]),
  }
}

export function locationFromRoutePoint(point: RoutePoint, label: string): CanonicalLocation {
  return {
    id: `route-point:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`,
    label,
    lat: point.lat,
    lng: point.lng,
  }
}
