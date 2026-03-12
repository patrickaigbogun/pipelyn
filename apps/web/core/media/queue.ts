import { MediaOptimizationError, optimizeUploadedMedia } from './optimize'
import type { MediaPresetName } from './presets'
import { getStorageAdapter } from '../storage'
import { usageCounter } from '../usage'

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

export type JobResultMeta = {
	kind: 'image' | 'video'
	strategy: string
	contentType: string
	filename: string
	outputBytes: number
	savedBytes: number
	savedPercent: number
	inputDurationSec: number | undefined
	outputDurationSec: number | undefined
	inputWidth: number | undefined
	outputWidth: number | undefined
}

export type JobRecord = {
	id: string
	status: JobStatus
	preset: MediaPresetName
	filename: string
	contentType: string
	inputBytes: number
	storageKey: string | null
	result: JobResultMeta | null
	error: { message: string; code: string } | null
	createdAt: number
	updatedAt: number
	completedAt: number | null
}

type PendingInput = {
	jobId: string
	file: File
	preset: MediaPresetName
}

class MediaJobQueue {
	private readonly jobs = new Map<string, JobRecord>()
	private readonly inputQueue: PendingInput[] = []
	private running = false

	constructor() {
		// Poll every 200 ms for pending work
		setInterval(() => void this.tick(), 200)
	}

	/**
	 * Enqueue a file for async optimization. Returns the job record immediately.
	 */
	enqueue(file: File, preset: MediaPresetName): JobRecord {
		const id = crypto.randomUUID()
		const now = Date.now()
		const record: JobRecord = {
			id,
			status: 'pending',
			preset,
			filename: file.name,
			contentType: file.type,
			inputBytes: file.size,
			storageKey: null,
			result: null,
			error: null,
			createdAt: now,
			updatedAt: now,
			completedAt: null,
		}
		this.jobs.set(id, record)
		this.inputQueue.push({ jobId: id, file, preset })
		return record
	}

	/**
	 * Look up a job by ID.
	 */
	getJob(id: string): JobRecord | null {
		return this.jobs.get(id) ?? null
	}

	/**
	 * Return a snapshot of all job records.
	 */
	listJobs(): JobRecord[] {
		return Array.from(this.jobs.values())
	}

	private async tick(): Promise<void> {
		if (this.running || this.inputQueue.length === 0) return
		const next = this.inputQueue.shift()!
		this.running = true
		try {
			await this.processJob(next)
		} finally {
			this.running = false
		}
	}

	private async processJob(input: PendingInput): Promise<void> {
		const job = this.jobs.get(input.jobId)
		if (!job) return

		job.status = 'processing'
		job.updatedAt = Date.now()

		try {
			const result = await optimizeUploadedMedia(input.file, input.preset)
			const storageKey = `jobs/${job.id}/${result.filename}`
			const storage = getStorageAdapter()
			await storage.put(storageKey, result.bytes, result.contentType)
			usageCounter.record(result)

			job.status = 'done'
			job.storageKey = storageKey
			job.result = {
				kind: result.kind,
				strategy: result.strategy,
				contentType: result.contentType,
				filename: result.filename,
				outputBytes: result.outputBytes,
				savedBytes: result.savedBytes,
				savedPercent: result.savedPercent,
				inputDurationSec: result.inputProbe.durationSec,
				outputDurationSec: result.outputProbe.durationSec,
				inputWidth: result.inputProbe.width,
				outputWidth: result.outputProbe.width,
			}
			job.completedAt = Date.now()
		} catch (err) {
			job.status = 'failed'
			if (err instanceof MediaOptimizationError) {
				job.error = { message: err.message, code: err.code }
			} else {
				job.error = {
					message: err instanceof Error ? err.message : 'Unknown error',
					code: 'unknown',
				}
			}
			job.completedAt = Date.now()
		} finally {
			job.updatedAt = Date.now()
		}
	}
}

let _queue: MediaJobQueue | null = null

export function getJobQueue(): MediaJobQueue {
	if (!_queue) _queue = new MediaJobQueue()
	return _queue
}
