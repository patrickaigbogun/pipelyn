/**
 * @pipelyn/sdk — unit tests
 *
 * Uses Bun's built-in test runner (bun test).
 * No real HTTP calls are made; fetch is replaced with mock implementations.
 */

import { describe, expect, it, mock, beforeEach } from 'bun:test'
import {
	createPipelynClient,
	PipelynError,
	type JobStatusResponse,
	type OptimizeMediaResult,
} from '../src/index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlob(content: string, type = 'image/jpeg'): Blob {
	return new Blob([content], { type })
}

function makeFile(name: string, content: string, type = 'image/jpeg'): File {
	return new File([content], name, { type })
}

/** Build a minimal Response that looks like a successful optimize response. */
function makeOptimizeResponse(overrides: Partial<Record<string, string>> = {}): Response {
	const headers = new Headers({
		'content-type': 'image/webp',
		'content-disposition': 'inline; filename="output.webp"',
		'x-pipelyn-kind': 'image',
		'x-pipelyn-preset': 'web',
		'x-pipelyn-strategy': 'image-webp',
		'x-pipelyn-input-bytes': '50000',
		'x-pipelyn-output-bytes': '20000',
		'x-pipelyn-saved-bytes': '30000',
		'x-pipelyn-saved-percent': '60',
		'x-pipelyn-input-duration': '',
		'x-pipelyn-output-duration': '',
		'x-pipelyn-input-width': '800',
		'x-pipelyn-output-width': '800',
		...overrides,
	})
	return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200, headers })
}

// ---------------------------------------------------------------------------
// optimizeMedia
// ---------------------------------------------------------------------------

describe('optimizeMedia', () => {
	it('sends multipart form and returns typed result', async () => {
		const captured: { url: string; method: string; body: FormData }[] = []

		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			captured.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as FormData })
			return makeOptimizeResponse()
		}) as unknown as typeof fetch

		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		const result = await client.optimizeMedia({ media: makeFile('photo.jpg', 'data') })

		expect(captured).toHaveLength(1)
		expect(captured[0].url).toBe('http://localhost:7990/api/media/optimize')
		expect(captured[0].method).toBe('POST')

		expect(result.kind).toBe('image')
		expect(result.preset).toBe('web')
		expect(result.strategy).toBe('image-webp')
		expect(result.savedPercent).toBe(60)
		expect(result.inputBytes).toBe(50000)
		expect(result.outputBytes).toBe(20000)
		expect(result.savedBytes).toBe(30000)
		expect(result.filename).toBe('output.webp')
		expect(result.contentType).toBe('image/webp')
		expect(result.bytes).toBeInstanceOf(Uint8Array)
		expect(result.blob).toBeInstanceOf(Blob)
	})

	it('accepts Blob, Uint8Array, and ArrayBuffer inputs', async () => {
		const types: Array<File | Blob | Uint8Array | ArrayBuffer> = [
			makeFile('a.jpg', 'data'),
			makeBlob('data', 'image/jpeg'),
			new Uint8Array([1, 2, 3]),
			new Uint8Array([1, 2, 3]).buffer,
		]

		for (const media of types) {
			globalThis.fetch = mock(async () => makeOptimizeResponse()) as unknown as typeof fetch
			const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
			const result = await client.optimizeMedia({ media })
			expect(result.kind).toBe('image')
		}
	})

	it('injects x-api-key header when apiKey is configured', async () => {
		const captured: Headers[] = []

		globalThis.fetch = mock(async (_url: unknown, init?: RequestInit) => {
			captured.push(new Headers(init?.headers as HeadersInit))
			return makeOptimizeResponse()
		}) as unknown as typeof fetch

		const client = createPipelynClient({
			baseUrl: 'http://localhost:7990/api',
			apiKey: 'test-key-123',
		})
		await client.optimizeMedia({ media: makeFile('img.jpg', 'x') })

		expect(captured[0].get('x-api-key')).toBe('test-key-123')
	})
})

// ---------------------------------------------------------------------------
// optimizeImage / optimizeVideo type assertion
// ---------------------------------------------------------------------------

describe('optimizeImage', () => {
	it('throws if response kind is video', async () => {
		globalThis.fetch = mock(async () =>
			makeOptimizeResponse({ 'x-pipelyn-kind': 'video', 'content-type': 'video/mp4' })
		) as unknown as typeof fetch

		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		await expect(
			client.optimizeImage({ media: makeFile('img.jpg', 'x') })
		).rejects.toBeInstanceOf(PipelynError)
	})

	it('rejects non-image content type before sending', async () => {
		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		await expect(
			client.optimizeImage({ media: makeFile('clip.mp4', 'x', 'video/mp4') })
		).rejects.toMatchObject({ code: 'invalid-input' })
	})
})

describe('optimizeVideo', () => {
	it('rejects non-video content type before sending', async () => {
		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		await expect(
			client.optimizeVideo({ media: makeFile('img.jpg', 'x', 'image/jpeg') })
		).rejects.toMatchObject({ code: 'invalid-input' })
	})
})

// ---------------------------------------------------------------------------
// Async jobs
// ---------------------------------------------------------------------------

describe('submitJob / getJobStatus / waitForJob', () => {
	it('submitJob sends POST and returns job ID', async () => {
		globalThis.fetch = mock(async () =>
			new Response(JSON.stringify({ jobId: 'job-1', status: 'pending', createdAt: 1741694400000 }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			})
		) as unknown as typeof fetch

		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		const job = await client.submitJob({ media: makeFile('video.mp4', 'x', 'video/mp4') })

		expect(job.jobId).toBe('job-1')
		expect(job.status).toBe('pending')
	})

	it('getJobStatus returns parsed status response', async () => {
		const body: JobStatusResponse = {
			jobId: 'job-1',
			status: 'done',
			preset: 'web',
			filename: 'out.mp4',
			inputBytes: 4000000,
			createdAt: 1741694400000,
			updatedAt: 1741694500000,
			completedAt: 1741694500000,
			result: {
				kind: 'video',
				strategy: 'video-mp4-h264',
				contentType: 'video/mp4',
				filename: 'out.mp4',
				outputBytes: 800000,
				savedBytes: 3200000,
				savedPercent: 80,
				inputDurationSec: 60,
				outputDurationSec: 60,
				inputWidth: 1920,
				outputWidth: 720,
			},
			downloadUrl: 'http://localhost:7990/api/media/jobs/job-1/download',
		}

		globalThis.fetch = mock(async () =>
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		) as unknown as typeof fetch

		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		const status = await client.getJobStatus('job-1')

		expect(status.status).toBe('done')
		expect(status.result?.savedPercent).toBe(80)
		expect(status.downloadUrl).toContain('job-1')
	})

	it('waitForJob resolves once job reaches done', async () => {
		let callCount = 0
		const responses: JobStatusResponse[] = [
			{ jobId: 'j1', status: 'pending', preset: 'web', filename: 'f', inputBytes: 0, createdAt: 0, updatedAt: 0, completedAt: null, downloadUrl: null },
			{ jobId: 'j1', status: 'processing', preset: 'web', filename: 'f', inputBytes: 0, createdAt: 0, updatedAt: 0, completedAt: null, downloadUrl: null },
			{
				jobId: 'j1', status: 'done', preset: 'web', filename: 'out.webp', inputBytes: 1000,
				createdAt: 0, updatedAt: 0, completedAt: 100,
				result: { kind: 'image', strategy: 'image-webp', contentType: 'image/webp', filename: 'out.webp', outputBytes: 400, savedBytes: 600, savedPercent: 60, inputDurationSec: undefined, outputDurationSec: undefined, inputWidth: 800, outputWidth: 800 },
				downloadUrl: 'http://localhost:7990/api/media/jobs/j1/download',
			},
		]

		globalThis.fetch = mock(async () => {
			const resp = responses[Math.min(callCount, responses.length - 1)]
			callCount++
			return new Response(JSON.stringify(resp), { status: 200, headers: { 'content-type': 'application/json' } })
		}) as unknown as typeof fetch

		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		const final = await client.waitForJob('j1', { pollIntervalMs: 0 })

		expect(final.status).toBe('done')
		expect(final.result?.savedPercent).toBe(60)
		expect(callCount).toBeGreaterThanOrEqual(3)
	})

	it('waitForJob throws PipelynError when job fails', async () => {
		const failed: JobStatusResponse = {
			jobId: 'j2', status: 'failed', preset: 'web', filename: 'f', inputBytes: 0,
			createdAt: 0, updatedAt: 0, completedAt: 0,
			error: { message: 'ffmpeg timed out', code: 'encode-timeout' },
			downloadUrl: null,
		}

		globalThis.fetch = mock(async () =>
			new Response(JSON.stringify(failed), { status: 200, headers: { 'content-type': 'application/json' } })
		) as unknown as typeof fetch

		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		await expect(client.waitForJob('j2', { pollIntervalMs: 0 })).rejects.toBeInstanceOf(PipelynError)
	})

	it('waitForJob throws when maxWaitMs is exceeded', async () => {
		const pending: JobStatusResponse = {
			jobId: 'j3', status: 'pending', preset: 'web', filename: 'f', inputBytes: 0,
			createdAt: 0, updatedAt: 0, completedAt: null, downloadUrl: null,
		}

		globalThis.fetch = mock(async () =>
			new Response(JSON.stringify(pending), { status: 200, headers: { 'content-type': 'application/json' } })
		) as unknown as typeof fetch

		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		// maxWaitMs=0 ensures immediate timeout
		await expect(client.waitForJob('j3', { pollIntervalMs: 0, maxWaitMs: 0 })).rejects.toMatchObject({
			code: 'aborted',
		})
	})
})

// ---------------------------------------------------------------------------
// Retry behaviour
// ---------------------------------------------------------------------------

describe('retry', () => {
	it('retries on configured HTTP status codes and eventually succeeds', async () => {
		let callCount = 0

		globalThis.fetch = mock(async () => {
			callCount++
			if (callCount < 3) {
				return new Response('service unavailable', { status: 503 })
			}
			return makeOptimizeResponse()
		}) as unknown as typeof fetch

		const client = createPipelynClient({
			baseUrl: 'http://localhost:7990/api',
			retry: { retries: 3, baseDelayMs: 0, maxDelayMs: 0 },
		})
		const result = await client.optimizeMedia({ media: makeFile('img.jpg', 'x') })

		expect(callCount).toBe(3)
		expect(result.kind).toBe('image')
	})

	it('throws PipelynError after all retries are exhausted', async () => {
		globalThis.fetch = mock(async () =>
			new Response('internal server error', { status: 500 })
		) as unknown as typeof fetch

		const client = createPipelynClient({
			baseUrl: 'http://localhost:7990/api',
			retry: { retries: 2, baseDelayMs: 0, maxDelayMs: 0 },
		})

		await expect(
			client.optimizeMedia({ media: makeFile('img.jpg', 'x') })
		).rejects.toBeInstanceOf(PipelynError)
	})

	it('does not retry on non-retriable status codes', async () => {
		let callCount = 0

		globalThis.fetch = mock(async () => {
			callCount++
			return new Response('bad request', { status: 400 })
		}) as unknown as typeof fetch

		const client = createPipelynClient({
			baseUrl: 'http://localhost:7990/api',
			retry: { retries: 3, baseDelayMs: 0, maxDelayMs: 0 },
		})

		await expect(
			client.optimizeMedia({ media: makeFile('img.jpg', 'x') })
		).rejects.toMatchObject({ code: 'http', status: 400, retriable: false })

		// Only 1 attempt; no retries for 400
		expect(callCount).toBe(1)
	})

	it('surfaces abort errors as PipelynError with code "aborted"', async () => {
		const controller = new AbortController()
		controller.abort()

		globalThis.fetch = mock(async (_url: unknown, init?: RequestInit) => {
			if (init?.signal?.aborted) {
				const err = new DOMException('Aborted', 'AbortError')
				throw err
			}
			return makeOptimizeResponse()
		}) as unknown as typeof fetch

		const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
		await expect(
			client.optimizeMedia({ media: makeFile('img.jpg', 'x'), signal: controller.signal })
		).rejects.toMatchObject({ code: 'aborted', retriable: false })
	})
})

// ---------------------------------------------------------------------------
// PipelynError shape
// ---------------------------------------------------------------------------

describe('PipelynError', () => {
	it('carries code, status, retriable, and details', () => {
		const err = new PipelynError('something went wrong', {
			code: 'http',
			status: 413,
			retriable: false,
			details: 'file too large',
		})

		expect(err).toBeInstanceOf(Error)
		expect(err).toBeInstanceOf(PipelynError)
		expect(err.name).toBe('PipelynError')
		expect(err.code).toBe('http')
		expect(err.status).toBe(413)
		expect(err.retriable).toBe(false)
		expect(err.details).toBe('file too large')
		expect(err.message).toBe('something went wrong')
	})

	it('defaults retriable to false when not supplied', () => {
		const err = new PipelynError('oops', { code: 'network' })
		expect(err.retriable).toBe(false)
	})
})
