import type { ProviderProvenance } from '@shared/contracts/expedition'
import {
  PlanExpeditionUseCase,
  ReverseGeocodeUseCase,
  SearchLocationsUseCase,
} from './application/plan-expedition'
import { ApplicationError } from './errors'
import { GraphHopperGeocodingProvider } from './integrations/graphhopper-geocoding'
import { OrsRoutingProvider } from './integrations/ors-routing'
import { OverpassSettlementProvider } from './integrations/overpass-settlements'
import { cachedPlanFor } from './fallback'

function requiredEnv(name: 'ORS_API_KEY' | 'GRAPHHOPPER_API_KEY'): string {
  const value = process.env[name]
  if (!value) throw new ApplicationError('UNKNOWN_ERROR', 'Provider configuration is unavailable.')
  return value
}

export function createComposition() {
  const routingProvider = new OrsRoutingProvider(requiredEnv('ORS_API_KEY'))
  const geocodingProvider = new GraphHopperGeocodingProvider(requiredEnv('GRAPHHOPPER_API_KEY'))
  const settlementProvider = new OverpassSettlementProvider()
  const provenance: ProviderProvenance = {
    routingProvider: 'openrouteservice',
    elevationProvider: 'openrouteservice route elevation',
    settlementProvider: 'OpenStreetMap Overpass',
    geocodingProvider: 'GraphHopper',
    source: 'live',
  }
  return {
    planExpedition: new PlanExpeditionUseCase(
      routingProvider,
      settlementProvider,
      provenance,
      cachedPlanFor,
    ),
    searchLocations: new SearchLocationsUseCase(geocodingProvider),
    reverseGeocode: new ReverseGeocodeUseCase(geocodingProvider),
  }
}
