import fs from 'node:fs/promises'

import type {
  CanonicalLocation,
  ExpeditionInput,
  NormalizedRoute,
} from '@shared/contracts/expedition'
import {
  buildExpeditionPlan,
  ELEVATION_RECONCILIATION_TOLERANCE_METERS,
  normalizeRoute,
  PlanningDomainError,
  type ProviderRoute,
} from '@shared/domain/planning'

import { ApplicationError } from '../../src/server/errors'
import { GraphHopperGeocodingProvider } from '../../src/server/integrations/graphhopper-geocoding'
import {
  OrsRoutingProvider,
  type OrsRoutingProfile,
} from '../../src/server/integrations/ors-routing'
import { OverpassSettlementProvider } from '../../src/server/integrations/overpass-settlements'
import type { ExecutionContext } from '../../src/server/network'
import {
  formatProviderValidationStatus,
  providerValidationExitCode,
  summarizeProviderValidation,
} from './status'

const ROUTES = [
  {
    id: 'sf-santa-cruz',
    label: 'San Francisco -> Santa Cruz',
    start: [-122.4194, 37.7749],
    end: [-122.0308, 36.9741],
  },
  {
    id: 'portland-eugene',
    label: 'Portland -> Eugene',
    start: [-122.6765, 45.5231],
    end: [-123.0868, 44.0521],
  },
  {
    id: 'amsterdam-brussels',
    label: 'Amsterdam -> Brussels',
    start: [4.9041, 52.3676],
    end: [4.3517, 50.8503],
  },
  {
    id: 'munich-salzburg',
    label: 'Munich -> Salzburg',
    start: [11.582, 48.1351],
    end: [13.055, 47.8095],
  },
  {
    id: 'bandung-pangandaran',
    label: 'Bandung -> Pangandaran',
    start: [107.6191, -6.9175],
    end: [108.353, -7.6907],
  },
  {
    id: 'yogyakarta-pacitan',
    label: 'Yogyakarta -> Pacitan',
    start: [110.3695, -7.7956],
    end: [111.1077, -8.2016],
  },
] as const

const VALIDATION_PROFILES = [
  { routeProfile: 'paved-priority', providerProfile: 'cycling-road', production: true },
  { routeProfile: 'mixed-surface', providerProfile: 'cycling-regular', production: true },
  {
    routeProfile: 'mixed-surface',
    providerProfile: 'cycling-mountain',
    production: false,
  },
] as const

type RouteCase = (typeof ROUTES)[number]
type ValidationProfile = (typeof VALIDATION_PROFILES)[number]
type RouteProfile = ValidationProfile['routeProfile']

type RouteResult = {
  provider: 'openrouteservice'
  routeId: string
  routeProfile: RouteProfile
  providerProfile: OrsRoutingProfile
  validationRole: 'production' | 'diagnostic'
  success: boolean
  latencyMs: number
  distanceMeters?: number
  ascentMeters?: number
  descentMeters?: number
  coordinateCount?: number
  elevationAvailable?: boolean
  elevationPlausible?: boolean
  maxElevationDeltaMeters?: number
  maxElevationDeltaHorizontalDistanceMeters?: number
  suspiciousElevationJumpCount?: number
  routeRatio?: number
  stageAscentDifferenceMeters?: number
  stageDescentDifferenceMeters?: number
  stageMetricsReconcile?: boolean
  errorCode?: string
  normalizedRoute?: NormalizedRoute
}

type GeocodeResult = {
  provider: 'graphhopper'
  query: string
  success: boolean
  count: number
  latencyMs: number
  errorCode?: string
}

type SettlementResult = {
  provider: 'openstreetmap-overpass'
  routeId: string
  routeProfile: RouteProfile
  providerProfile: OrsRoutingProfile
  success: boolean
  normalizedCandidateCount: number
  latencyMs: number
  errorCode?: string
}

function loadEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return []
      const separator = trimmed.indexOf('=')
      return separator === -1 ? [] : [[trimmed.slice(0, separator), trimmed.slice(separator + 1)]]
    }),
  )
}

function context(): ExecutionContext {
  return {
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 20_000,
  }
}

function location(route: RouteCase, endpoint: 'start' | 'destination'): CanonicalLocation {
  const coordinates = endpoint === 'start' ? route.start : route.end
  return {
    id: `validation:${route.id}:${endpoint}`,
    label: endpoint === 'start' ? route.label.split(' -> ')[0] : route.label.split(' -> ')[1],
    lng: coordinates[0],
    lat: coordinates[1],
  }
}

function inputFor(route: RouteCase, routeProfile: RouteProfile): ExpeditionInput {
  return {
    start: location(route, 'start'),
    destination: location(route, 'destination'),
    days: 3,
    bikeType: 'gravel',
    routeProfile,
    fitness: 'intermediate',
  }
}

function errorCode(error: unknown): string {
  if (error instanceof PlanningDomainError) return 'PROVIDER_RESPONSE_INVALID'
  if (error instanceof ApplicationError) return error.code
  return error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR'
}

function elevationDiagnostics(coordinates: readonly number[][]): {
  maxElevationDeltaMeters?: number
  maxElevationDeltaHorizontalDistanceMeters?: number
  suspiciousElevationJumpCount: number
} {
  let maxElevationDeltaMeters: number | undefined
  let maxElevationDeltaHorizontalDistanceMeters: number | undefined
  let suspiciousElevationJumpCount = 0

  for (let index = 1; index < coordinates.length; index += 1) {
    const [fromLng, fromLat, fromElevation] = coordinates[index - 1]
    const [toLng, toLat, toElevation] = coordinates[index]
    if (
      !Number.isFinite(fromElevation) ||
      !Number.isFinite(toElevation) ||
      !Number.isFinite(fromLng) ||
      !Number.isFinite(fromLat) ||
      !Number.isFinite(toLng) ||
      !Number.isFinite(toLat)
    ) {
      continue
    }

    const horizontalDistanceMeters = haversineMeters([fromLng, fromLat], [toLng, toLat])
    const elevationDeltaMeters = Math.abs(toElevation - fromElevation)
    if (maxElevationDeltaMeters === undefined || elevationDeltaMeters > maxElevationDeltaMeters) {
      maxElevationDeltaMeters = elevationDeltaMeters
      maxElevationDeltaHorizontalDistanceMeters = horizontalDistanceMeters
    }
    if (horizontalDistanceMeters < 100 && elevationDeltaMeters > 100) {
      suspiciousElevationJumpCount += 1
    }
  }

  return {
    maxElevationDeltaMeters:
      maxElevationDeltaMeters === undefined
        ? undefined
        : Number(maxElevationDeltaMeters.toFixed(1)),
    maxElevationDeltaHorizontalDistanceMeters:
      maxElevationDeltaHorizontalDistanceMeters === undefined
        ? undefined
        : Number(maxElevationDeltaHorizontalDistanceMeters.toFixed(1)),
    suspiciousElevationJumpCount,
  }
}

function stageMetricDiagnostics(input: ExpeditionInput, route: NormalizedRoute) {
  const plan = buildExpeditionPlan(input, route, [], {
    routingProvider: 'openrouteservice',
    elevationProvider: 'openrouteservice route elevation',
    settlementProvider: 'validation fixture',
    geocodingProvider: 'validation fixture',
    source: 'live',
  })
  const stageAscent = plan.stages.reduce((total, stage) => total + stage.ascentMeters, 0)
  const stageDescent = plan.stages.reduce((total, stage) => total + stage.descentMeters, 0)
  const stageAscentDifferenceMeters = Math.abs(stageAscent - route.ascentMeters)
  const stageDescentDifferenceMeters = Math.abs(stageDescent - route.descentMeters)
  return {
    stageAscentDifferenceMeters: Number(stageAscentDifferenceMeters.toFixed(3)),
    stageDescentDifferenceMeters: Number(stageDescentDifferenceMeters.toFixed(3)),
    stageMetricsReconcile:
      stageAscentDifferenceMeters <= ELEVATION_RECONCILIATION_TOLERANCE_METERS &&
      stageDescentDifferenceMeters <= ELEVATION_RECONCILIATION_TOLERANCE_METERS,
  }
}

async function runOrsRoute(
  provider: OrsRoutingProvider,
  route: RouteCase,
  profile: ValidationProfile,
): Promise<RouteResult> {
  const startedAt = performance.now()
  let diagnostics: ReturnType<typeof elevationDiagnostics> = {
    suspiciousElevationJumpCount: 0,
  }
  try {
    const input = inputFor(route, profile.routeProfile)
    const providerRoute: ProviderRoute = profile.production
      ? await provider.route(input, context())
      : await provider.routeWithProfile(input, context(), profile.providerProfile)
    diagnostics = elevationDiagnostics(providerRoute.coordinates)
    const normalizedRoute = normalizeRoute(providerRoute)
    const stageDiagnostics = stageMetricDiagnostics(input, normalizedRoute)
    const success = stageDiagnostics.stageMetricsReconcile
    return {
      provider: 'openrouteservice',
      routeId: route.id,
      routeProfile: profile.routeProfile,
      providerProfile: profile.providerProfile,
      validationRole: profile.production ? 'production' : 'diagnostic',
      success,
      latencyMs: Math.round(performance.now() - startedAt),
      distanceMeters: Math.round(normalizedRoute.distanceMeters),
      ascentMeters: Math.round(normalizedRoute.ascentMeters),
      descentMeters: Math.round(normalizedRoute.descentMeters),
      coordinateCount: normalizedRoute.geometry.coordinates.length,
      elevationAvailable: normalizedRoute.geometry.coordinates.some(
        (point) => point.length >= 3 && Number.isFinite(point[2]),
      ),
      elevationPlausible: true,
      ...diagnostics,
      ...stageDiagnostics,
      errorCode: success ? undefined : 'STAGE_METRICS_MISMATCH',
      routeRatio: Number(
        (normalizedRoute.distanceMeters / haversineMeters(route.start, route.end)).toFixed(2),
      ),
      normalizedRoute,
    }
  } catch (error) {
    return {
      provider: 'openrouteservice',
      routeId: route.id,
      routeProfile: profile.routeProfile,
      providerProfile: profile.providerProfile,
      validationRole: profile.production ? 'production' : 'diagnostic',
      success: false,
      latencyMs: Math.round(performance.now() - startedAt),
      errorCode: errorCode(error),
      elevationPlausible: error instanceof PlanningDomainError ? false : undefined,
      ...diagnostics,
    }
  }
}

async function runGeocode(
  provider: GraphHopperGeocodingProvider,
  query: string,
): Promise<GeocodeResult> {
  const startedAt = performance.now()
  try {
    const results = await provider.search(query, context())
    return {
      provider: 'graphhopper',
      query,
      success: results.length <= 5,
      count: results.length,
      latencyMs: Math.round(performance.now() - startedAt),
      errorCode: results.length <= 5 ? undefined : 'RESULT_LIMIT_EXCEEDED',
    }
  } catch (error) {
    return {
      provider: 'graphhopper',
      query,
      success: false,
      count: 0,
      latencyMs: Math.round(performance.now() - startedAt),
      errorCode: errorCode(error),
    }
  }
}

async function runSettlements(
  provider: OverpassSettlementProvider,
  route: RouteCase,
  routeProfile: RouteProfile,
  providerProfile: OrsRoutingProfile,
  normalizedRoute: NormalizedRoute,
): Promise<SettlementResult> {
  const startedAt = performance.now()
  try {
    const settlements = await provider.findAlongRoute(normalizedRoute, context())
    return {
      provider: 'openstreetmap-overpass',
      routeId: route.id,
      routeProfile,
      providerProfile,
      success: true,
      normalizedCandidateCount: settlements.length,
      latencyMs: Math.round(performance.now() - startedAt),
    }
  } catch (error) {
    return {
      provider: 'openstreetmap-overpass',
      routeId: route.id,
      routeProfile,
      providerProfile,
      success: false,
      normalizedCandidateCount: 0,
      latencyMs: Math.round(performance.now() - startedAt),
      errorCode: errorCode(error),
    }
  }
}

function haversineMeters(
  [fromLng, fromLat]: readonly [number, number],
  [toLng, toLat]: readonly [number, number],
): number {
  const radius = 6_371_008.8
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const latDelta = toRadians(toLat - fromLat)
  const lngDelta = toRadians(toLng - fromLng)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(lngDelta / 2) ** 2
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function printTable(title: string, rows: object[], fields: string[]) {
  console.log(`\n${title}`)
  console.table(
    rows.map((row) =>
      Object.fromEntries(
        fields.map((field) => [field, (row as Record<string, unknown>)[field] ?? '']),
      ),
    ),
  )
}

const env = loadEnv(await fs.readFile('.env', 'utf8'))
if (!env.ORS_API_KEY || !env.GRAPHHOPPER_API_KEY) {
  console.error('Missing ORS_API_KEY or GRAPHHOPPER_API_KEY in .env')
  process.exitCode = 1
} else {
  const routingProvider = new OrsRoutingProvider(env.ORS_API_KEY)
  const geocodingProvider = new GraphHopperGeocodingProvider(env.GRAPHHOPPER_API_KEY)
  const settlementProvider = new OverpassSettlementProvider()
  const routeResults: RouteResult[] = []
  const geocodeResults: GeocodeResult[] = []
  const settlementResults: SettlementResult[] = []

  for (const route of ROUTES) {
    const orsResults = await Promise.all(
      VALIDATION_PROFILES.map((profile) => runOrsRoute(routingProvider, route, profile)),
    )
    routeResults.push(...orsResults)
    const productionResults = orsResults.filter((result) => result.validationRole === 'production')
    settlementResults.push(
      ...(await Promise.all(
        productionResults.flatMap((result) =>
          result.success && result.normalizedRoute
            ? [
                runSettlements(
                  settlementProvider,
                  route,
                  result.routeProfile,
                  result.providerProfile,
                  result.normalizedRoute,
                ),
              ]
            : [],
        ),
      )),
    )
    geocodeResults.push(await runGeocode(geocodingProvider, route.label.split(' -> ')[0]))
    console.log(
      `${route.label}: ${orsResults.map((result) => `${result.providerProfile}=${result.success ? 'PASS' : result.errorCode}`).join(', ')}`,
    )
  }

  printTable('Production routing / elevation', routeResults, [
    'provider',
    'routeId',
    'routeProfile',
    'providerProfile',
    'validationRole',
    'success',
    'latencyMs',
    'distanceMeters',
    'ascentMeters',
    'descentMeters',
    'coordinateCount',
    'elevationAvailable',
    'elevationPlausible',
    'maxElevationDeltaMeters',
    'maxElevationDeltaHorizontalDistanceMeters',
    'suspiciousElevationJumpCount',
    'routeRatio',
    'stageAscentDifferenceMeters',
    'stageDescentDifferenceMeters',
    'stageMetricsReconcile',
    'errorCode',
  ])
  printTable('Production geocoding', geocodeResults, [
    'provider',
    'query',
    'success',
    'count',
    'latencyMs',
    'errorCode',
  ])
  printTable('Settlement corridor checks from normalized production routes', settlementResults, [
    'provider',
    'routeId',
    'routeProfile',
    'success',
    'normalizedCandidateCount',
    'latencyMs',
    'errorCode',
  ])

  const productionRouteResults = routeResults.filter(
    (result) => result.validationRole === 'production',
  )
  const expectedProductionResults =
    ROUTES.length * VALIDATION_PROFILES.filter((profile) => profile.production).length
  const summary = summarizeProviderValidation(
    productionRouteResults,
    geocodeResults,
    settlementResults,
    expectedProductionResults,
    ROUTES.length,
    productionRouteResults.filter((result) => result.success).length,
  )
  const coreSummary = summarizeProviderValidation(
    productionRouteResults,
    geocodeResults,
    [],
    expectedProductionResults,
    ROUTES.length,
    0,
  )
  const corridorSummary = summarizeProviderValidation(
    productionRouteResults.map(() => ({ success: true })),
    geocodeResults.map(() => ({ success: true })),
    settlementResults,
    expectedProductionResults,
    geocodeResults.length,
    productionRouteResults.filter((result) => result.success).length,
  )
  console.log(`\nCore provider status: ${formatProviderValidationStatus(coreSummary)}`)
  console.log(`Settlement corridor status: ${formatProviderValidationStatus(corridorSummary)}`)
  const status = formatProviderValidationStatus(summary)
  console.log(`\nProvider validation status: ${status}`)

  await fs.mkdir('artifacts/provider-validation', { recursive: true })
  await fs.writeFile(
    'artifacts/provider-validation/latest.json',
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        status: summary,
        coreStatus: coreSummary,
        settlementStatus: corridorSummary,
        routeResults: routeResults.map(({ normalizedRoute, ...result }) => result),
        geocodeResults,
        settlementResults,
      },
      null,
      2,
    )}\n`,
  )
  process.exitCode = providerValidationExitCode(summary.status)
}
