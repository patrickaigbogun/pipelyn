import type { Elysia } from 'elysia'

import { PIPELYN_MAX_INPUT_BYTES, maxInputMegabytes } from '../../core/media/limits'
import { MediaOptimizationError, optimizeUploadedMedia } from '../../core/media/optimize'
import { MEDIA_PRESETS } from '../../core/media/presets'
import { usageCounter } from '../../core/usage'

export default function media<const App extends Elysia>(api: App) {
	return api
		.get('/media/presets', () => ({
			defaultPreset: 'web',
			presets: Object.values(MEDIA_PRESETS),
		}))
		.get('/media/limits', () => ({
			maxInputBytes: PIPELYN_MAX_INPUT_BYTES,
			maxInputMegabytes: maxInputMegabytes(),
		}))
		.post('/media/optimize', async ({ request, set }) => {
			try {
				const form = await request.formData()
				const media = form.get('media')
				const presetField = form.get('preset')
				const preset = typeof presetField === 'string' ? presetField : undefined

				if (!(media instanceof File)) {
					set.status = 400
					return { error: 'Expected multipart form with media file in "media" field' }
				}

				const result = await optimizeUploadedMedia(media, preset)
				usageCounter.record(result)
				const payload = Uint8Array.from(result.bytes)
				return new Response(new Blob([payload], { type: result.contentType }), {
					headers: {
						'content-type': result.contentType,
						'content-disposition': `inline; filename="${result.filename}"`,
						'x-pipelyn-kind': result.kind,
						'x-pipelyn-preset': result.preset,
						'x-pipelyn-strategy': result.strategy,
						'x-pipelyn-input-bytes': String(result.inputBytes),
						'x-pipelyn-output-bytes': String(result.outputBytes),
						'x-pipelyn-saved-bytes': String(result.savedBytes),
						'x-pipelyn-saved-percent': String(result.savedPercent),
						'x-pipelyn-input-duration': String(result.inputProbe.durationSec ?? ''),
						'x-pipelyn-output-duration': String(result.outputProbe.durationSec ?? ''),
						'x-pipelyn-input-width': String(result.inputProbe.width ?? ''),
						'x-pipelyn-output-width': String(result.outputProbe.width ?? ''),
						'x-pipelyn-total-bytes-saved': String(usageCounter.totalSavedBytes),
						'x-pipelyn-total-jobs': String(usageCounter.totalJobs),
					},
				})
			} catch (error) {
				if (error instanceof MediaOptimizationError) {
					set.status = error.status
					return {
						error: error.message,
						code: error.code,
					}
				}

				set.status = 500
				return {
					error: error instanceof Error ? error.message : 'Unknown optimization error',
					code: 'unknown',
				}
			}
		})
}
