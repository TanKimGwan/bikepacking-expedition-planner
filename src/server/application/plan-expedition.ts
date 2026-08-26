import {
  ExpeditionInputSchema,
  type ExpeditionInput,
  type ProviderProvenance,
} from '@shared/contracts/expedition'
import {
  buildExpeditionPlan,
  MAX_ROUTE_DISTANCE_METERS,
  normalizeRoute,
  validatePlanningLimits,
} from '@shared/domain/planning'
import { PlanningDomainError } from '@shared/domain/planning'
import { ApplicationError } from '../errors'
import type { ExecutionContext } from '../network'
import type { GeocodingProvider, RoutingProvider, SettlementProvider } from '../integrations/types'

type FallbackPlan = (input: ExpeditionInput) => ReturnType<typeof buildExpeditionPlan> | null

export class PlanExpeditionUseCase {
  constructor(
    private readonly routingProvider: RoutingProvider,
    private readonly settlementProvider: SettlementProvider,
    private readonly provenance: ProviderProvenance,
    private readonly fallbackPlan?: FallbackPlan,
  ) {}

  async execute(rawInput: unknown, context: ExecutionContext) {
    const parsed = ExpeditionInputSchema.safeParse(rawInput)
    if (!parsed.success)
      throw new ApplicationError(
        'INVALID_INPUT',
        'Enter a valid start, destination, and trip setup.',
      )
    const input: ExpeditionInput = parsed.data
    try {
      validatePlanningLimits(input)
      const providerRoute = await this.routingProvider.route(input, context)
      let route
      try {
        route = normalizeRoute(providerRoute)
      } catch (error) {
        if (error instanceof PlanningDomainError) {
          throw new ApplicationError(
            'PROVIDER_RESPONSE_INVALID',
            'The routing provider returned an invalid route.',
          )
        }
        throw error
      }
      if (route.distanceMeters > MAX_ROUTE_DISTANCE_METERS) {
        throw new ApplicationError(
          'ROUTE_TOO_LONG',
          'The routed distance is beyond the 1,000 km MVP limit.',
        )
      }
      const settlements = await this.settlementProvider.findAlongRoute(route, context)
      return buildExpeditionPlan(input, route, settlements, this.provenance)
    } catch (error) {
      if (error instanceof ApplicationError) {
        if (
          [
            'ROUTING_FAILED',
            'PROVIDER_TIMEOUT',
            'SETTLEMENT_LOOKUP_FAILED',
            'PROVIDER_RESPONSE_INVALID',
            'UNKNOWN_ERROR',
          ].includes(error.code)
        ) {
          const fallback = this.fallbackPlan?.(input)
          if (fallback) return fallback
        }
        throw error
      }
      if (error instanceof PlanningDomainError) {
        throw new ApplicationError(error.code, error.message)
      }
      throw new ApplicationError('UNKNOWN_ERROR', 'The expedition could not be generated.')
    }
  }
}

export class SearchLocationsUseCase {
  constructor(private readonly geocodingProvider: GeocodingProvider) {}

  async execute(query: string, context: ExecutionContext) {
    if (query.trim().length < 3) return []
    return this.geocodingProvider.search(query.trim(), context)
  }
}

export class ReverseGeocodeUseCase {
  constructor(private readonly geocodingProvider: GeocodingProvider) {}

  async execute(lat: number, lng: number, context: ExecutionContext) {
    return this.geocodingProvider.reverse(lat, lng, context)
  }
}
