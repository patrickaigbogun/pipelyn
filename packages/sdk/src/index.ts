export type MediaPresetName = 'mobile' | 'web' | 'low-bandwidth'

type MediaKind = 'image' | 'video'

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

export type JobResultMeta = {
	kind: MediaKind
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

export type CreateJobResponse = {
	jobId: string
	status: JobStatus
	createdAt: number
}

export type JobStatusResponse = {
	jobId: string
	status: JobStatus
	preset: MediaPresetName
	filename: string
	inputBytes: number
	createdAt: number
	updatedAt: number
	completedAt: number | null
	result?: JobResultMeta
	error?: { message: string; code: string }
	downloadUrl: string | null
}

export type UsageSnapshot = {
	totalJobs: number
	totalInputBytes: number
	totalOutputBytes: number
	totalSavedBytes: number
}

export type PipelynErrorCode =
	| 'aborted'
	| 'network'
	| 'http'
	| 'invalid-input'
	| 'invalid-response'

export type MediaPreset = {
	name: MediaPresetName
	maxWidth: number
	imageQuality: number
	videoCrf: number
	videoBitrateKbps: number
	audioBitrateKbps: number
}

export type PresetsResponse = {
	defaultPreset: MediaPresetName
	presets: MediaPreset[]
}

export type OptimizeMediaInput = {
	media: File | Blob | Uint8Array | ArrayBuffer
	preset?: MediaPresetName
	filename?: string
	contentType?: string
	signal?: AbortSignal
}

export type OptimizeMediaResult = {
	bytes: Uint8Array
	blob: Blob
	filename: string
	contentType: string
	kind: MediaKind
	preset: MediaPresetName
	strategy: string
	inputBytes: number
	outputBytes: number
	savedBytes: number
	savedPercent: number
	inputDurationSec: number
	outputDurationSec: number
	inputWidth: number
	outputWidth: number
}

export type PipelynClientOptions = {
	baseUrl: string
	defaultPreset?: MediaPresetName
	/**
	 * API key sent as `x-api-key` header on every request.
	 * Only required when the server has `PIPELYN_API_KEYS` configured.
	 */
	apiKey?: string
	headers?: HeadersInit
	retry?: Partial<PipelynRetryOptions>
}

export type PipelynRetryOptions = {
	retries: number
	baseDelayMs: number
	maxDelayMs: number
	retryOnStatuses: number[]
}

export type PipelynErrorOptions = {
	code: PipelynErrorCode
	status?: number
	retriable?: boolean
	cause?: unknown
	details?: string
}

export class PipelynError extends Error {
	readonly code: PipelynErrorCode
	readonly status?: number
	readonly retriable: boolean
	readonly cause?: unknown
	readonly details?: string

	constructor(message: string, opts: PipelynErrorOptions) {
		super(message)
		this.name = 'PipelynError'
		this.code = opts.code
		this.status = opts.status
		this.retriable = Boolean(opts.retriable)
		this.cause = opts.cause
		this.details = opts.details
	}
}

const DEFAULT_RETRY: PipelynRetryOptions = {
	retries: 2,
	baseDelayMs: 250,
	maxDelayMs: 2500,
	retryOnStatuses: [408, 425, 429, 500, 502, 503, 504],
}

function trimSlash(url: string): string {
	return url.endsWith('/') ? url.slice(0, -1) : url
}

function mergeRetryOptions(input?: Partial<PipelynRetryOptions>): PipelynRetryOptions {
	if (!input) return { ...DEFAULT_RETRY }
	return {
		retries: Math.max(0, input.retries ?? DEFAULT_RETRY.retries),
		baseDelayMs: Math.max(1, input.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs),
		maxDelayMs: Math.max(1, input.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs),
		retryOnStatuses: input.retryOnStatuses ?? DEFAULT_RETRY.retryOnStatuses,
	}
}

function toHeaders(input?: HeadersInit): Headers {
	return new Headers(input ?? {})
}

function isAbortError(cause: unknown): boolean {
	if (!cause || typeof cause !== 'object') return false
	const name = 'name' in cause ? String((cause as { name?: unknown }).name) : ''
	return name === 'AbortError'
}

function retryDelay(attempt: number, retry: PipelynRetryOptions): number {
	const raw = retry.baseDelayMs * Math.pow(2, attempt)
	const jitter = Math.floor(Math.random() * 120)
	return Math.min(retry.maxDelayMs, raw + jitter)
}

async function sleep(ms: number, signal?: AbortSignal) {
	if (signal?.aborted) {
		throw new PipelynError('Request aborted before retry delay', {
			code: 'aborted',
			retriable: false,
		})
	}
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms)
		if (!signal) return
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer)
				reject(
					new PipelynError('Request aborted during retry delay', {
						code: 'aborted',
						retriable: false,
					})
				)
			},
			{ once: true }
		)
	})
}

function buildFile(input: OptimizeMediaInput): File {
	if (input.media instanceof File) return input.media
	if (input.media instanceof Blob) {
		return new File([input.media], input.filename ?? 'media.bin', {
			type: input.contentType ?? input.media.type ?? 'application/octet-stream',
		})
	}
	if (input.media instanceof Uint8Array) {
		const copy = new Uint8Array(input.media)
		return new File([copy], input.filename ?? 'media.bin', {
			type: input.contentType ?? 'application/octet-stream',
		})
	}
	return new File([new Uint8Array(input.media)], input.filename ?? 'media.bin', {
		type: input.contentType ?? 'application/octet-stream',
	})
}

function parseNum(value: string | null): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function parseFilename(contentDisposition: string | null): string {
	if (!contentDisposition) return 'optimized.bin'
	const match = contentDisposition.match(/filename="?([^";]+)"?/i)
	return match?.[1] ?? 'optimized.bin'
}

async function safeResponseText(res: Response): Promise<string> {
	try {
		return await res.text()
	} catch {
		return ''
	}
}

function assertKind(result: OptimizeMediaResult, expected: MediaKind) {
	if (result.kind !== expected) {
		throw new PipelynError(`Expected ${expected} response but received ${result.kind}`, {
			code: 'invalid-response',
			retriable: false,
		})
	}
}

export class PipelynClient {
	private readonly baseUrl: string
	private readonly defaultPreset: MediaPresetName
	private readonly apiKey?: string
	private readonly headers?: HeadersInit
	private readonly retry: PipelynRetryOptions

	constructor(opts: PipelynClientOptions) {
		this.baseUrl = trimSlash(opts.baseUrl)
		this.defaultPreset = opts.defaultPreset ?? 'web'
		this.apiKey = opts.apiKey
		this.headers = opts.headers
		this.retry = mergeRetryOptions(opts.retry)
	}

	/** Build base headers, injecting x-api-key when an apiKey is configured. */
	private baseHeaders(): Headers {
		const headers = toHeaders(this.headers)
		if (this.apiKey) headers.set('x-api-key', this.apiKey)
		return headers
	}

	private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
		let lastError: unknown = null

		for (let attempt = 0; attempt <= this.retry.retries; attempt++) {
			try {
				const res = await fetch(url, init)
				if (res.ok) return res

				const details = await safeResponseText(res)
				const retriable = this.retry.retryOnStatuses.includes(res.status)
				if (!retriable || attempt === this.retry.retries) {
					throw new PipelynError(`Request failed with status ${res.status}`, {
						code: 'http',
						status: res.status,
						retriable,
						details,
					})
				}

				await sleep(retryDelay(attempt, this.retry), init.signal ?? undefined)
				continue
			} catch (cause) {
				if (cause instanceof PipelynError) {
					if (!cause.retriable || attempt === this.retry.retries) throw cause
					await sleep(retryDelay(attempt, this.retry), init.signal ?? undefined)
					lastError = cause
					continue
				}

				if (isAbortError(cause)) {
					throw new PipelynError('Request aborted', {
						code: 'aborted',
						retriable: false,
						cause,
					})
				}

				const networkError = new PipelynError('Network request failed', {
					code: 'network',
					retriable: true,
					cause,
				})

				if (attempt === this.retry.retries) throw networkError
				lastError = networkError
				await sleep(retryDelay(attempt, this.retry), init.signal ?? undefined)
			}
		}

		throw (
			lastError ??
			new PipelynError('Request failed after retries', {
				code: 'network',
				retriable: false,
			})
		)
	}

	async getPresets(signal?: AbortSignal): Promise<PresetsResponse> {
		const res = await this.fetchWithRetry(`${this.baseUrl}/media/presets`, {
			method: 'GET',
			headers: this.baseHeaders(),
			signal,
		})
		return (await res.json()) as PresetsResponse
	}

	async optimizeImage(input: OptimizeMediaInput): Promise<OptimizeMediaResult> {
		const file = buildFile(input)
		const contentType = input.contentType ?? file.type
		if (contentType && !contentType.startsWith('image/')) {
			throw new PipelynError(`Expected image media type, received ${contentType}`, {
				code: 'invalid-input',
				retriable: false,
			})
		}
		const result = await this.optimizeMedia({ ...input, media: file })
		assertKind(result, 'image')
		return result
	}

	async optimizeVideo(input: OptimizeMediaInput): Promise<OptimizeMediaResult> {
		const file = buildFile(input)
		const contentType = input.contentType ?? file.type
		if (contentType && !contentType.startsWith('video/')) {
			throw new PipelynError(`Expected video media type, received ${contentType}`, {
				code: 'invalid-input',
				retriable: false,
			})
		}
		const result = await this.optimizeMedia({ ...input, media: file })
		assertKind(result, 'video')
		return result
	}

	async optimizeMedia(input: OptimizeMediaInput): Promise<OptimizeMediaResult> {
		const mediaFile = buildFile(input)
		const form = new FormData()
		form.set('media', mediaFile)
		form.set('preset', input.preset ?? this.defaultPreset)
		const headers = this.baseHeaders()
		headers.delete('content-type')

		const res = await this.fetchWithRetry(`${this.baseUrl}/media/optimize`, {
			method: 'POST',
			body: form,
			headers,
			signal: input.signal,
		})

		const bytes = new Uint8Array(await res.arrayBuffer())
		const contentType = res.headers.get('content-type') ?? 'application/octet-stream'

		return {
			bytes,
			blob: new Blob([bytes], { type: contentType }),
			filename: parseFilename(res.headers.get('content-disposition')),
			contentType,
			kind: (res.headers.get('x-pipelyn-kind') ?? 'image') as MediaKind,
			preset: (res.headers.get('x-pipelyn-preset') ?? this.defaultPreset) as MediaPresetName,
			strategy: res.headers.get('x-pipelyn-strategy') ?? 'unknown',
			inputBytes: parseNum(res.headers.get('x-pipelyn-input-bytes')),
			outputBytes: parseNum(res.headers.get('x-pipelyn-output-bytes')),
			savedBytes: parseNum(res.headers.get('x-pipelyn-saved-bytes')),
			savedPercent: parseNum(res.headers.get('x-pipelyn-saved-percent')),
			inputDurationSec: parseNum(res.headers.get('x-pipelyn-input-duration')),
			outputDurationSec: parseNum(res.headers.get('x-pipelyn-output-duration')),
			inputWidth: parseNum(res.headers.get('x-pipelyn-input-width')),
			outputWidth: parseNum(res.headers.get('x-pipelyn-output-width')),
		}
	}

	/**
	 * Submit a media file for async optimization and return immediately with a job ID.
	 */
	async submitJob(input: OptimizeMediaInput): Promise<CreateJobResponse> {
		const mediaFile = buildFile(input)
		const form = new FormData()
		form.set('media', mediaFile)
		form.set('preset', input.preset ?? this.defaultPreset)
		const headers = this.baseHeaders()
		headers.delete('content-type')

		const res = await this.fetchWithRetry(`${this.baseUrl}/media/jobs`, {
			method: 'POST',
			body: form,
			headers,
			signal: input.signal,
		})
		return (await res.json()) as CreateJobResponse
	}

	/**
	 * Poll for the status of a previously submitted job.
	 */
	async getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatusResponse> {
		const res = await this.fetchWithRetry(`${this.baseUrl}/media/jobs/${jobId}`, {
			method: 'GET',
			headers: this.baseHeaders(),
			signal,
		})
		return (await res.json()) as JobStatusResponse
	}

	/**
	 * Poll until the job reaches a terminal state ("done" or "failed"), then
	 * return the final status response. Throws if the job fails, or if
	 * `maxWaitMs` is exceeded.
	 */
	async waitForJob(
		jobId: string,
		{
			pollIntervalMs = 1000,
			maxWaitMs = 300_000,
			signal,
		}: { pollIntervalMs?: number; maxWaitMs?: number; signal?: AbortSignal } = {}
	): Promise<JobStatusResponse> {
		const deadline = Date.now() + maxWaitMs
		while (true) {
			const status = await this.getJobStatus(jobId, signal)
			if (status.status === 'done') return status
			if (status.status === 'failed') {
				throw new PipelynError(status.error?.message ?? 'Job failed', {
					code: 'http',
					retriable: false,
					details: status.error?.code,
				})
			}
			if (Date.now() >= deadline) {
				throw new PipelynError(`Job ${jobId} did not complete within ${maxWaitMs}ms`, {
					code: 'aborted',
					retriable: false,
				})
			}
			await sleep(pollIntervalMs, signal)
		}
	}

	/**
	 * Retrieve the server-side usage snapshot (total jobs processed, bytes saved, etc).
	 */
	async getUsage(signal?: AbortSignal): Promise<UsageSnapshot> {
		const res = await this.fetchWithRetry(`${this.baseUrl}/usage`, {
			method: 'GET',
			headers: this.baseHeaders(),
			signal,
		})
		return (await res.json()) as UsageSnapshot
	}
}

export function createPipelynClient(opts: PipelynClientOptions) {
	return new PipelynClient(opts)
}
