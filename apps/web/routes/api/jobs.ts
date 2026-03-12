import type { Elysia } from 'elysia'
import { PIPELYN_MAX_INPUT_BYTES, maxInputMegabytes } from '../../core/media/limits'
import type { MediaPresetName } from '../../core/media/presets'
import { getJobQueue } from '../../core/media/queue'
import { getStorageAdapter } from '../../core/storage'

function resolvePreset(raw: FormDataEntryValue | null): MediaPresetName {
	const allowed: MediaPresetName[] = ['mobile', 'web', 'low-bandwidth']
	if (typeof raw === 'string' && allowed.includes(raw as MediaPresetName))
		return raw as MediaPresetName
	return 'web'
}

export default function jobs<const App extends Elysia>(api: App) {
	return api
		/**
		 * POST /media/jobs
		 * Accepts the same multipart form as POST /media/optimize but returns a
		 * job ID immediately instead of waiting for encoding to finish.
		 */
		.post('/media/jobs', async ({ request, set }) => {
			let form: FormData
			try {
				form = await request.formData()
			} catch {
				set.status = 413
				return {
					error: `Upload too large. Maximum per file is ${maxInputMegabytes()}MB.`,
					code: 'too-large',
				}
			}
			const media = form.get('media')
			const preset = resolvePreset(form.get('preset'))

			if (!(media instanceof File)) {
				set.status = 400
				return { error: 'Expected multipart form with media file in "media" field', code: 'invalid-input' }
			}

			if (media.size > PIPELYN_MAX_INPUT_BYTES) {
				set.status = 413
				return {
					error: `Media file exceeds input limit (${maxInputMegabytes()}MB)`,
					code: 'too-large',
				}
			}

			const queue = getJobQueue()
			const job = queue.enqueue(media, preset)

			set.status = 202
			return {
				jobId: job.id,
				status: job.status,
				createdAt: job.createdAt,
			}
		})

		/**
		 * GET /media/jobs/:id
		 * Poll for job status. When done, includes a download URL (presigned S3 or
		 * local redirect) in "downloadUrl".
		 */
		.get('/media/jobs/:id', async ({ params, request, set }) => {
			const queue = getJobQueue()
			const job = queue.getJob(params.id)

			if (!job) {
				set.status = 404
				return { error: 'Job not found', code: 'not-found' }
			}

			let downloadUrl: string | null = null

			if (job.status === 'done' && job.storageKey) {
				const storage = getStorageAdapter()
				if ('presignedUrl' in storage && typeof (storage as { presignedUrl: unknown }).presignedUrl === 'function') {
					downloadUrl = await (storage as { presignedUrl(k: string, ex: number): string | Promise<string> }).presignedUrl(job.storageKey, 3600)
				} else {
					// Local: expose a direct download URL through the API
					const origin = new URL(request.url).origin
					downloadUrl = `${origin}/api/media/jobs/${job.id}/download`
				}
			}

			return {
				jobId: job.id,
				status: job.status,
				preset: job.preset,
				filename: job.filename,
				inputBytes: job.inputBytes,
				createdAt: job.createdAt,
				updatedAt: job.updatedAt,
				completedAt: job.completedAt,
				result: job.result ?? undefined,
				error: job.error ?? undefined,
				downloadUrl,
			}
		})

		/**
		 * GET /media/jobs/:id/download
		 * Streams the optimized output directly for local storage adapter. Only
		 * used when presignedUrl() is not available on the adapter.
		 */
		.get('/media/jobs/:id/download', async ({ params, set }) => {
			const queue = getJobQueue()
			const job = queue.getJob(params.id)

			if (!job) {
				set.status = 404
				return { error: 'Job not found', code: 'not-found' }
			}

			if (job.status !== 'done' || !job.storageKey || !job.result) {
				set.status = 409
				return { error: `Job is in status "${job.status}"`, code: 'not-ready' }
			}

			const storage = getStorageAdapter()
			const stored = await storage.get(job.storageKey)

			if (!stored) {
				set.status = 404
				return { error: 'Output file not found in storage', code: 'not-found' }
			}

			return new Response(new Blob([stored.data.buffer as ArrayBuffer], { type: stored.contentType }), {
				headers: {
					'content-type': stored.contentType,
					'content-disposition': `attachment; filename="${job.result.filename}"`,
					'cache-control': 'no-store',
				},
			})
		})
}
