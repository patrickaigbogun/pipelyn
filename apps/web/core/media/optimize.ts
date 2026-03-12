import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PIPELYN_MAX_INPUT_BYTES, maxInputMegabytes } from './limits'
import { resolvePreset, type MediaPresetName } from './presets'

type MediaKind = 'image' | 'video'

type OutputStrategy = {
	label: string
	contentType: string
	ext: string
	ffmpegArgs: string[]
}

export type MediaProbe = {
	formatName?: string
	durationSec?: number
	bitrate?: number
	width?: number
	height?: number
	fps?: number
	videoCodec?: string
	audioCodec?: string
}

type ProcessResult = {
	stdout: string
	stderr: string
}

type MediaErrorCode =
	| 'invalid-input'
	| 'unsupported-type'
	| 'too-large'
	| 'probe-failed'
	| 'encode-failed'
	| 'encode-timeout'

export class MediaOptimizationError extends Error {
	readonly code: MediaErrorCode
	readonly status: number

	constructor(message: string, code: MediaErrorCode, status: number) {
		super(message)
		this.name = 'MediaOptimizationError'
		this.code = code
		this.status = status
	}
}

const FFPROBE_TIMEOUT_MS = Number(process.env.PIPELYN_FFPROBE_TIMEOUT_MS ?? 15000)
const IMAGE_TIMEOUT_MS = Number(process.env.PIPELYN_IMAGE_TIMEOUT_MS ?? 30000)
const VIDEO_TIMEOUT_MS = Number(process.env.PIPELYN_VIDEO_TIMEOUT_MS ?? 240000)

export type OptimizationResult = {
	kind: MediaKind
	preset: MediaPresetName
	strategy: string
	contentType: string
	filename: string
	inputBytes: number
	outputBytes: number
	savedBytes: number
	savedPercent: number
	inputProbe: MediaProbe
	outputProbe: MediaProbe
	bytes: Uint8Array
}

function inferKind(file: File): MediaKind {
	if (file.type.startsWith('video/')) return 'video'
	if (file.type.startsWith('image/')) return 'image'
	throw new MediaOptimizationError(`Unsupported media type: ${file.type || 'unknown'}`, 'unsupported-type', 415)
}

function safeBaseName(name: string): string {
	const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '')
	return cleaned || 'media'
}

async function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
	const proc = Bun.spawn([cmd, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	})

	const stdoutText = new Response(proc.stdout).text()
	const stderrText = new Response(proc.stderr).text()
	const exitCode = proc.exited
	const timeout = new Promise<never>((_, reject) => {
		const timer = setTimeout(() => {
			try {
				proc.kill('SIGKILL')
			} catch {
				// no-op
			}
			reject(
				new MediaOptimizationError(
					`${cmd} timed out after ${timeoutMs}ms`,
					'encode-timeout',
					504
				)
			)
		}, timeoutMs)
		exitCode.finally(() => clearTimeout(timer))
	})

	const code = await Promise.race([exitCode, timeout])
	const [stdout, stderr] = await Promise.all([stdoutText, stderrText])
	if (code !== 0) {
		throw new MediaOptimizationError(`${cmd} failed (${code})\n${stderr || stdout}`, 'encode-failed', 422)
	}
	return { stdout, stderr }
}

function fpsToNumber(raw: string | undefined): number | undefined {
	if (!raw || !raw.includes('/')) return undefined
	const [num, den] = raw.split('/').map((n) => Number(n))
	if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined
	return Number((num / den).toFixed(3))
}

async function probeMedia(filePath: string): Promise<MediaProbe> {
	const args = [
		'-v',
		'error',
		'-show_entries',
		'format=duration,bit_rate,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate',
		'-of',
		'json',
		filePath,
	]

	try {
		const { stdout } = await runCommand('ffprobe', args, FFPROBE_TIMEOUT_MS)
		const parsed = JSON.parse(stdout) as {
			format?: { duration?: string; bit_rate?: string; format_name?: string }
			streams?: Array<{
				codec_type?: string
				codec_name?: string
				width?: number
				height?: number
				r_frame_rate?: string
			}>
		}

		const video = parsed.streams?.find((s) => s.codec_type === 'video')
		const audio = parsed.streams?.find((s) => s.codec_type === 'audio')

		return {
			formatName: parsed.format?.format_name,
			durationSec: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
			bitrate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : undefined,
			width: video?.width,
			height: video?.height,
			fps: fpsToNumber(video?.r_frame_rate),
			videoCodec: video?.codec_name,
			audioCodec: audio?.codec_name,
		}
	} catch (cause) {
		if (cause instanceof MediaOptimizationError) throw cause
		throw new MediaOptimizationError('ffprobe failed to parse media metadata', 'probe-failed', 422)
	}
}

function buildImageStrategy(label: string, outputPath: string, codecArgs: string[]) {
	const ext = path.extname(outputPath)
	const contentType = ext === '.avif' ? 'image/avif' : ext === '.jpg' ? 'image/jpeg' : 'image/webp'
	return {
		label,
		contentType,
		ext,
		ffmpegArgs: codecArgs,
	} as OutputStrategy
}

function buildStrategies(kind: MediaKind, inputPath: string, outputBasePath: string, presetName: MediaPresetName): OutputStrategy[] {
	const preset = resolvePreset(presetName)
	if (kind === 'image') {
		const scale = `scale='min(iw,${preset.maxWidth})':-2:flags=lanczos`
		const avifPath = `${outputBasePath}.avif`
		const webpPath = `${outputBasePath}.webp`
		const jpegPath = `${outputBasePath}.jpg`

		const avif = buildImageStrategy('image-avif', avifPath, [
			'-y',
			'-i',
			inputPath,
			'-vf',
			scale,
			'-c:v',
			'libaom-av1',
			'-cpu-used',
			'6',
			'-crf',
			String(Math.max(28, Math.min(45, preset.videoCrf + 7))),
			avifPath,
		])

		const webp = buildImageStrategy('image-webp', webpPath, [
			'-y',
			'-i',
			inputPath,
			'-vf',
			scale,
			'-c:v',
			'libwebp',
			'-q:v',
			String(Math.max(50, Math.min(96, preset.imageQuality))),
			webpPath,
		])

		const jpeg = buildImageStrategy('image-jpeg', jpegPath, [
			'-y',
			'-i',
			inputPath,
			'-vf',
			scale,
			'-q:v',
			String(Math.max(2, Math.round((100 - preset.imageQuality) / 4))),
			jpegPath,
		])

		if (preset.name === 'low-bandwidth') return [avif, webp, jpeg]
		return [webp, avif, jpeg]
	}

	const scale = `scale='min(iw,${preset.maxWidth})':-2:flags=lanczos`
	const mp4Path = `${outputBasePath}.mp4`
	const webmPath = `${outputBasePath}.webm`

	const mp4: OutputStrategy = {
		label: 'video-mp4-h264',
		contentType: 'video/mp4',
		ext: '.mp4',
		ffmpegArgs: [
			'-y',
			'-i',
			inputPath,
			'-vf',
			scale,
			'-c:v',
			'libx264',
			'-profile:v',
			'main',
			'-pix_fmt',
			'yuv420p',
			'-preset',
			'veryfast',
			'-crf',
			String(preset.videoCrf),
			'-maxrate',
			`${preset.videoBitrateKbps}k`,
			'-bufsize',
			`${preset.videoBitrateKbps * 2}k`,
			'-c:a',
			'aac',
			'-b:a',
			`${preset.audioBitrateKbps}k`,
			'-movflags',
			'+faststart',
			mp4Path,
		],
	}

	const webm: OutputStrategy = {
		label: 'video-webm-vp9',
		contentType: 'video/webm',
		ext: '.webm',
		ffmpegArgs: [
			'-y',
			'-i',
			inputPath,
			'-vf',
			scale,
			'-c:v',
			'libvpx-vp9',
			'-row-mt',
			'1',
			'-crf',
			String(preset.videoCrf + 2),
			'-b:v',
			`${Math.max(600, preset.videoBitrateKbps - 300)}k`,
			'-c:a',
			'libopus',
			'-b:a',
			`${preset.audioBitrateKbps}k`,
			webmPath,
		],
	}

	if (preset.name === 'low-bandwidth') return [webm, mp4]
	return [mp4, webm]
}

export async function optimizeUploadedMedia(file: File, presetInput: string | undefined): Promise<OptimizationResult> {
	if (!(file instanceof File)) {
		throw new MediaOptimizationError('Media input must be a file', 'invalid-input', 400)
	}
	if (!Number.isFinite(file.size) || file.size <= 0) {
		throw new MediaOptimizationError('Media file is empty or invalid', 'invalid-input', 400)
	}
	if (file.size > PIPELYN_MAX_INPUT_BYTES) {
		throw new MediaOptimizationError(
			`Media file exceeds input limit (${maxInputMegabytes()}MB)`,
			'too-large',
			413
		)
	}

	const kind = inferKind(file)
	const preset = resolvePreset(presetInput)
	const tempDir = await mkdtemp(path.join(tmpdir(), 'pipelyn-'))
	const sourceExt = kind === 'video' ? '.input.mp4' : '.input'
	const base = safeBaseName(file.name)
	const inputPath = path.join(tempDir, `${base}${sourceExt}`)
	const outputBasePath = path.join(tempDir, `${base}.optimized`)
	const timeoutMs = kind === 'video' ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS

	try {
		const inputBytes = new Uint8Array(await file.arrayBuffer())
		await writeFile(inputPath, inputBytes)
		const inputProbe = await probeMedia(inputPath)
		const strategies = buildStrategies(kind, inputPath, outputBasePath, preset.name)

		let selected: OutputStrategy | null = null
		let outputPath = ''
		for (const strategy of strategies) {
			try {
				await runCommand('ffmpeg', strategy.ffmpegArgs, timeoutMs)
				selected = strategy
				outputPath = `${outputBasePath}${strategy.ext}`
				break
			} catch (cause) {
				if (cause instanceof MediaOptimizationError && cause.code === 'encode-timeout') throw cause
				// fall through to next strategy
			}
		}

		if (!selected || !outputPath) {
			throw new MediaOptimizationError('Unable to encode output with available strategies', 'encode-failed', 422)
		}

		const outStats = await stat(outputPath)
		const outputBytes = outStats.size
		const savedBytes = Math.max(0, inputBytes.byteLength - outputBytes)
		const savedPercent = inputBytes.byteLength === 0 ? 0 : Number(((savedBytes / inputBytes.byteLength) * 100).toFixed(2))
		const bytes = await Bun.file(outputPath).bytes()
		const outputProbe = await probeMedia(outputPath)

		return {
			kind,
			preset: preset.name,
			strategy: selected.label,
			contentType: selected.contentType,
			filename: `${base}${selected.ext}`,
			inputBytes: inputBytes.byteLength,
			outputBytes,
			savedBytes,
			savedPercent,
			inputProbe,
			outputProbe,
			bytes,
		}
	} finally {
		await rm(tempDir, { recursive: true, force: true })
	}
}
