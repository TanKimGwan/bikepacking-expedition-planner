import type {
  CanonicalLocation,
  ExpeditionInput,
  NormalizedRoute,
} from '@shared/contracts/expedition'
import type { ProviderRoute } from '@shared/domain/planning'
import type { ExecutionContext } from '../network'

export interface RoutingProvider {
  route(input: ExpeditionInput, context: ExecutionContext): Promise<ProviderRoute>
}

export interface GeocodingProvider {
  search(query: string, context: ExecutionContext): Promise<CanonicalLocation[]>
  reverse(lat: number, lng: number, context: ExecutionContext): Promise<CanonicalLocation | null>
}

export interface SettlementProvider {
  findAlongRoute(route: NormalizedRoute, context: ExecutionContext): Promise<CanonicalLocation[]>
}
