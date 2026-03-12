import type { OptimizationResult } from '../media/optimize'

/**
 * Lightweight in-process usage counter.
 * Values reset on process restart — mount a persistence layer when needed.
 *
 * Exposes lifetime totals that are echoed back in API response headers so
 * callers always have up-to-date metering without a separate endpoint.
 */
class UsageCounter {
	totalJobs = 0
	totalInputBytes = 0
	totalOutputBytes = 0
	totalSavedBytes = 0

	record(result: Pick<OptimizationResult, 'inputBytes' | 'outputBytes' | 'savedBytes'>): void {
		this.totalJobs++
		this.totalInputBytes += result.inputBytes
		this.totalOutputBytes += result.outputBytes
		this.totalSavedBytes += result.savedBytes
	}

	snapshot() {
		return {
			totalJobs: this.totalJobs,
			totalInputBytes: this.totalInputBytes,
			totalOutputBytes: this.totalOutputBytes,
			totalSavedBytes: this.totalSavedBytes,
		}
	}

	reset(): void {
		this.totalJobs = 0
		this.totalInputBytes = 0
		this.totalOutputBytes = 0
		this.totalSavedBytes = 0
	}
}

export const usageCounter = new UsageCounter()
