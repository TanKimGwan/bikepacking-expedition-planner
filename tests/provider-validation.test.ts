import { describe, expect, it } from 'vitest'

import {
  formatProviderValidationStatus,
  providerValidationExitCode,
  summarizeProviderValidation,
} from '../scripts/provider-validation/status'

const passing = { success: true }

describe('provider validation status', () => {
  it('reports PASS only when every provider layer passes', () => {
    const summary = summarizeProviderValidation(
      [passing, passing],
      [passing],
      [passing, passing],
      2,
      1,
      2,
    )

    expect(summary).toEqual({ status: 'PASS' })
    expect(formatProviderValidationStatus(summary)).toBe('PASS')
    expect(providerValidationExitCode(summary.status)).toBe(0)
  })

  it('reports unavailable Overpass as partial with a failing exit code', () => {
    const summary = summarizeProviderValidation(
      [passing, passing],
      [passing],
      [
        { success: false, errorCode: 'SETTLEMENT_LOOKUP_FAILED' },
        { success: false, errorCode: 'SETTLEMENT_LOOKUP_FAILED' },
      ],
      2,
      1,
      2,
    )

    expect(summary).toEqual({ status: 'PARTIAL', reason: 'EXTERNAL_PROVIDER_UNAVAILABLE' })
    expect(formatProviderValidationStatus(summary)).toBe('PARTIAL / EXTERNAL_PROVIDER_UNAVAILABLE')
    expect(providerValidationExitCode(summary.status)).toBeGreaterThan(0)
  })

  it('reports core provider failures as FAIL', () => {
    const summary = summarizeProviderValidation(
      [{ success: false, errorCode: 'PROVIDER_RESPONSE_INVALID' }, passing],
      [passing],
      [],
      2,
      1,
      2,
    )

    expect(summary).toEqual({ status: 'FAIL', reason: 'CORE_PROVIDER_FAILURE' })
    expect(providerValidationExitCode(summary.status)).toBeGreaterThan(0)
  })
})
