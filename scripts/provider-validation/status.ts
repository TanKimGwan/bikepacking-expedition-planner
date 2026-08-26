export type ProviderValidationCheck = {
  success: boolean
  errorCode?: string
}

export type ProviderValidationStatus = 'PASS' | 'PARTIAL' | 'FAIL'

export type ProviderValidationSummary =
  | { status: 'PASS' }
  | {
      status: 'PARTIAL'
      reason: 'EXTERNAL_PROVIDER_UNAVAILABLE' | 'CORRIDOR_VALIDATION_INCOMPLETE'
    }
  | { status: 'FAIL'; reason: 'CORE_PROVIDER_FAILURE' }

export function summarizeProviderValidation(
  routingResults: readonly ProviderValidationCheck[],
  geocodeResults: readonly ProviderValidationCheck[],
  settlementResults: readonly ProviderValidationCheck[],
  expectedRoutingResults: number,
  expectedGeocodeResults: number,
  expectedSettlementResults: number,
): ProviderValidationSummary {
  const corePasses =
    routingResults.length === expectedRoutingResults &&
    routingResults.every((result) => result.success) &&
    geocodeResults.length === expectedGeocodeResults &&
    geocodeResults.every((result) => result.success)
  if (!corePasses) return { status: 'FAIL', reason: 'CORE_PROVIDER_FAILURE' }

  const failedSettlements = settlementResults.filter((result) => !result.success)
  if (failedSettlements.length > 0 || settlementResults.length !== expectedSettlementResults) {
    const externalUnavailable =
      settlementResults.length === 0 ||
      (failedSettlements.length > 0 &&
        failedSettlements.every((result) => result.errorCode === 'SETTLEMENT_LOOKUP_FAILED'))
    return {
      status: 'PARTIAL',
      reason: externalUnavailable
        ? 'EXTERNAL_PROVIDER_UNAVAILABLE'
        : 'CORRIDOR_VALIDATION_INCOMPLETE',
    }
  }

  return { status: 'PASS' }
}

export function formatProviderValidationStatus(summary: ProviderValidationSummary): string {
  return 'reason' in summary ? `${summary.status} / ${summary.reason}` : summary.status
}

export function providerValidationExitCode(status: ProviderValidationStatus): number {
  return status === 'PASS' ? 0 : status === 'PARTIAL' ? 2 : 1
}
