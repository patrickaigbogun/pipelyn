import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

type MediaPresetName = 'mobile' | 'web' | 'low-bandwidth'

type Preset = {
	name: MediaPresetName
	maxWidth: number
	imageQuality: number
	videoCrf: number
	videoBitrateKbps: number
	audioBitrateKbps: number
}

type ResultMeta = {
	kind: 'image' | 'video'
	inputKind: 'image' | 'video'
	preset: MediaPresetName
	inputBytes: number
	outputBytes: number
	savedBytes: number
	savedPercent: number
	contentType: string
	filename: string
	url: string
	inputFilename: string
	inputUrl: string
}

type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

type JobResult = {
	kind: 'image' | 'video'
	strategy: string
	contentType: string
	filename: string
	outputBytes: number
	savedBytes: number
	savedPercent: number
	inputDurationSec?: number
	outputDurationSec?: number
	inputWidth?: number
	outputWidth?: number
}

type JobState = {
	jobId: string
	status: JobStatus
	downloadUrl: string | null
	fileName?: string
	result?: JobResult
	error?: { message: string; code: string }
}

const DEFAULT_MAX_INPUT_BYTES = 120 * 1024 * 1024

export const metadata = { title: 'Pipelyn Optimizer' }

function bytesToLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function parseNumberHeader(value: string | null): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

export default function Page() {
	const [presets, setPresets] = useState<Preset[]>([])
	const [preset, setPreset] = useState<MediaPresetName>('web')
	const [mode, setMode] = useState<'sync' | 'async'>('sync')
	const [files, setFiles] = useState<File[]>([])
	const [dragging, setDragging] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string>('')
	const [result, setResult] = useState<ResultMeta | null>(null)
	const [jobs, setJobs] = useState<JobState[]>([])
	const [maxInputBytes, setMaxInputBytes] = useState(DEFAULT_MAX_INPUT_BYTES)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const latestJobStatusRef = useRef<Record<string, JobStatus>>({})

	useEffect(() => {
		let mounted = true
		fetch('/api/media/presets')
			.then(async (res) => {
				if (!res.ok) throw new Error(`Failed to load presets (${res.status})`)
				return (await res.json()) as { defaultPreset: MediaPresetName; presets: Preset[] }
			})
			.then((data) => {
				if (!mounted) return
				setPresets(data.presets)
				setPreset(data.defaultPreset)
			})
			.catch((cause) => {
				if (!mounted) return
				setError(cause instanceof Error ? cause.message : 'Could not load presets')
			})
		return () => {
			mounted = false
		}
	}, [])

	useEffect(() => {
		let mounted = true
		fetch('/api/media/limits')
			.then(async (res) => {
				if (!res.ok) throw new Error(`Failed to load limits (${res.status})`)
				return (await res.json()) as { maxInputBytes: number }
			})
			.then((data) => {
				if (!mounted || !Number.isFinite(data.maxInputBytes) || data.maxInputBytes <= 0) return
				setMaxInputBytes(data.maxInputBytes)
			})
			.catch(() => {
				// Keep default when limits endpoint is unavailable.
			})
		return () => {
			mounted = false
		}
	}, [])

	useEffect(() => {
		return () => {
			if (result?.url) URL.revokeObjectURL(result.url)
			if (result?.inputUrl) URL.revokeObjectURL(result.inputUrl)
		}
	}, [result])

	useEffect(() => {
		if (mode === 'sync' && files.length > 1) {
			setFiles((current) => current.slice(0, 1))
		}
	}, [mode, files.length])

	const canOptimize = files.length > 0 && !busy

	const selectedPreset = useMemo(
		() => presets.find((item) => item.name === preset) ?? null,
		[presets, preset]
	)

	const batchSummary = useMemo(() => {
		const completedJobs = jobs.filter((job) => job.status === 'done')
		const inFlightJobs = jobs.filter((job) => job.status === 'pending' || job.status === 'processing')
		const failedJobs = jobs.filter((job) => job.status === 'failed')

		return {
			totalJobs: jobs.length,
			completedJobs: completedJobs.length,
			inFlightJobs: inFlightJobs.length,
			failedJobs: failedJobs.length,
			totalSavedBytes: completedJobs.reduce((total, job) => total + (job.result?.savedBytes ?? 0), 0),
		}
	}, [jobs])

	function setPickedFiles(nextFiles: File[] | FileList | null) {
		const picked = Array.from(nextFiles ?? [])
		if (picked.length === 0) return

		const accepted = picked.filter((file) => file.size <= maxInputBytes)
		const rejected = picked.filter((file) => file.size > maxInputBytes)

		if (rejected.length > 0) {
			const firstNames = rejected
				.slice(0, 2)
				.map((file) => file.name)
				.join(', ')
			const remainder = rejected.length > 2 ? ` (+${rejected.length - 2} more)` : ''
			toast.error(`${rejected.length} file${rejected.length === 1 ? '' : 's'} skipped`, {
				description: `Max per file is ${bytesToLabel(maxInputBytes)}. ${firstNames}${remainder}`,
			})
		}

		if (accepted.length === 0) {
			setFiles([])
			setError(`No files accepted. Max per file is ${bytesToLabel(maxInputBytes)}.`)
			setJobs([])
			return
		}

		setFiles(mode === 'sync' ? [accepted[0]] : accepted)
		setError('')
		setJobs([])
	}

	function updateJob(jobId: string, patch: Partial<JobState>) {
		setJobs((current) => current.map((job) => (job.jobId === jobId ? { ...job, ...patch } : job)))
	}

	async function pollJob(jobId: string, fileName?: string) {
		const deadline = Date.now() + 5 * 60_000
		while (Date.now() < deadline) {
			const res = await fetch(`/api/media/jobs/${jobId}`)
			if (!res.ok) throw new Error(`Job poll failed (${res.status})`)
			const payload = (await res.json()) as JobState

			const previousStatus = latestJobStatusRef.current[jobId]
			if (previousStatus !== payload.status) {
				if (payload.status === 'processing') {
					toast.message(fileName ? `${fileName} is processing` : 'Job is processing')
				}
				if (payload.status === 'done') {
					toast.success(fileName ? `${fileName} optimized` : 'Optimization complete', {
						description: payload.result
							? `Saved ${bytesToLabel(payload.result.savedBytes)} (${payload.result.savedPercent.toFixed(2)}%)`
							: 'Job completed successfully.',
					})
				}
				if (payload.status === 'failed') {
					toast.error(fileName ? `${fileName} failed` : 'Queued job failed', {
						description: payload.error?.message ?? 'The optimizer could not process this file.',
					})
				}
				latestJobStatusRef.current[jobId] = payload.status
			}

			updateJob(jobId, payload)
			if (payload.status === 'done' || payload.status === 'failed') return payload
			await new Promise((resolve) => setTimeout(resolve, 900))
		}
		throw new Error('Job polling timed out')
	}

	async function runOptimize() {
		if (files.length === 0) return
		setBusy(true)
		setError('')
		setJobs([])
		latestJobStatusRef.current = {}
		if (result?.url) URL.revokeObjectURL(result.url)
		if (result?.inputUrl) URL.revokeObjectURL(result.inputUrl)
		setResult(null)

		try {
			if (mode === 'async') {
				const submittedJobs = await Promise.all(
					files.map(async (pickedFile) => {
						const form = new FormData()
						form.set('media', pickedFile)
						form.set('preset', preset)
						const submitRes = await fetch('/api/media/jobs', { method: 'POST', body: form })
						if (!submitRes.ok) {
							let details = `request failed (${submitRes.status})`
							try {
								const payload = (await submitRes.json()) as { error?: string }
								details = payload.error ?? details
							} catch {
								try {
									details = await submitRes.text()
								} catch {
									// Keep fallback details
								}
							}
							throw new Error(`${pickedFile.name}: ${details}`)
						}
						const submitted = (await submitRes.json()) as { jobId: string; status: JobStatus }
						return {
							jobId: submitted.jobId,
							status: submitted.status,
							downloadUrl: null,
							fileName: pickedFile.name,
						}
					})
				)

				setJobs(submittedJobs.map((job) => ({ ...job, error: undefined, result: undefined })))
				toast.success(`Queued ${submittedJobs.length} file${submittedJobs.length === 1 ? '' : 's'}`, {
					description: `Max per file: ${bytesToLabel(maxInputBytes)}`,
				})

				const settled = await Promise.all(
					submittedJobs.map(async ({ jobId, fileName }) => {
						try {
							const terminal = await pollJob(jobId, fileName)
							return { jobId, fileName, terminal }
						} catch (cause) {
							const message = cause instanceof Error ? cause.message : 'Async optimization failed'
							updateJob(jobId, {
								status: 'failed',
								error: { message, code: 'poll-failed' },
							})
							return { jobId, fileName, terminal: null, error: message }
						}
					})
				)

				const failed = settled.filter((item) => item.error || item.terminal?.status === 'failed')
				if (failed.length > 0) {
					throw new Error(`${failed.length} queued job${failed.length === 1 ? '' : 's'} failed`)
				}
				toast.success(`All ${settled.length} queued job${settled.length === 1 ? '' : 's'} completed`)
				return
			}

			const inputFile = files[0]
			const inputKind: 'image' | 'video' = inputFile.type.startsWith('video/') ? 'video' : 'image'
			const form = new FormData()
			form.set('media', inputFile)
			form.set('preset', preset)

			const res = await fetch('/api/media/optimize', { method: 'POST', body: form })
			if (!res.ok) throw new Error(await res.text())

			const bytes = new Uint8Array(await res.arrayBuffer())
			const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
			const blob = new Blob([bytes], { type: contentType })
			const url = URL.createObjectURL(blob)

			setResult({
				kind: (res.headers.get('x-pipelyn-kind') ?? 'image') as 'image' | 'video',
				inputKind,
				preset: (res.headers.get('x-pipelyn-preset') ?? preset) as MediaPresetName,
				inputBytes: parseNumberHeader(res.headers.get('x-pipelyn-input-bytes')),
				outputBytes: parseNumberHeader(res.headers.get('x-pipelyn-output-bytes')),
				savedBytes: parseNumberHeader(res.headers.get('x-pipelyn-saved-bytes')),
				savedPercent: parseNumberHeader(res.headers.get('x-pipelyn-saved-percent')),
				contentType,
				filename: (res.headers.get('content-disposition')?.match(/filename=\"?([^\";]+)/i)?.[1] ?? 'optimized-media').trim(),
				url,
				inputFilename: inputFile.name,
				inputUrl: URL.createObjectURL(inputFile),
			})
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'Optimization failed'
			setError(message)
			toast.error('Optimization failed', { description: message })
		} finally {
			setBusy(false)
		}
	}

	return (
		<main className="pipe-page">
			<section className="pipe-hero">
				<p className="pipe-eyebrow">Pipelyn / Media Optimizer</p>
				<h1>Ship Lighter Media Without Breaking Compatibility</h1>
				<p>
					Upload an image or video, pick a target profile, and get optimized output immediately.
				</p>
			</section>

			<section className="pipe-grid">
				<div className="pipe-panel">
					<h2>1. Choose Media</h2>
					<div className="pipe-mode-toggle" role="group" aria-label="Optimization mode">
						<button type="button" className={mode === 'sync' ? 'is-active' : ''} onClick={() => setMode('sync')}>
							Instant
						</button>
						<button type="button" className={mode === 'async' ? 'is-active' : ''} onClick={() => setMode('async')}>
							Queued
						</button>
					</div>
					<div
						className={`pipe-dropzone ${dragging ? 'is-dragging' : ''}`}
						onDragEnter={(event) => {
							event.preventDefault()
							setDragging(true)
						}}
						onDragOver={(event) => {
							event.preventDefault()
							setDragging(true)
						}}
						onDragLeave={(event) => {
							event.preventDefault()
							setDragging(false)
						}}
						onDrop={(event) => {
							event.preventDefault()
							setDragging(false)
							setPickedFiles(event.dataTransfer.files)
						}}
					>
						<p>
							{mode === 'async'
								? 'Drop one or more images/videos here or browse files'
								: 'Drop an image/video here or browse a file'}
						</p>
						<button type="button" onClick={() => fileInputRef.current?.click()}>
							{mode === 'async' ? 'Browse Files' : 'Browse File'}
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*,video/*"
							multiple={mode === 'async'}
							onChange={(event) => setPickedFiles(event.target.files)}
						/>
					</div>

					{files.length > 0 ? (
						<div className="pipe-file-list">
							{files.map((pickedFile) => (
								<div className="pipe-file" key={`${pickedFile.name}-${pickedFile.size}-${pickedFile.lastModified}`}>
									<strong>{pickedFile.name}</strong>
									<span>{pickedFile.type || 'unknown type'}</span>
									<span>{bytesToLabel(pickedFile.size)}</span>
								</div>
							))}
						</div>
					) : null}

					{mode === 'async' ? (
						<p className="pipe-note">
							Queued mode submits one job per file and polls in the background. Max per file: {bytesToLabel(maxInputBytes)}.
						</p>
					) : files.length > 1 ? (
						<p className="pipe-note">Instant mode uses the first selected file only.</p>
					) : null}
				</div>

				<div className="pipe-panel">
					<h2>2. Select Target</h2>
					<div className="pipe-preset-list">
						{presets.map((item) => (
							<button
								type="button"
								key={item.name}
								onClick={() => setPreset(item.name)}
								className={item.name === preset ? 'is-active' : ''}
							>
								<span>{item.name}</span>
								<small>{item.maxWidth}px max width</small>
							</button>
						))}
					</div>
					{selectedPreset ? (
						<ul className="pipe-specs">
							<li>Image quality: {selectedPreset.imageQuality}</li>
							<li>Video CRF: {selectedPreset.videoCrf}</li>
							<li>Video bitrate: {selectedPreset.videoBitrateKbps} kbps</li>
						</ul>
					) : null}
					<button type="button" className="pipe-run" disabled={!canOptimize} onClick={runOptimize}>
						{busy ? (mode === 'async' ? 'Submitting / Polling...' : 'Optimizing...') : mode === 'async' ? '3. Queue Job' : '3. Optimize Now'}
					</button>
				</div>
			</section>

			{error ? <p className="pipe-error">{error}</p> : null}

			{jobs.length > 0 ? (
				<section className="pipe-result">
					<div className="pipe-batch-summary">
						<div className="pipe-batch-summary__header">
							<h2>Batch Summary</h2>
							<p>
								{batchSummary.completedJobs} of {batchSummary.totalJobs} jobs complete.
								{batchSummary.failedJobs > 0 ? ` ${batchSummary.failedJobs} failed.` : ''}
							</p>
						</div>
						<div className="pipe-metrics pipe-metrics-compact">
							<div>
								<label>Total Jobs</label>
								<strong>{batchSummary.totalJobs}</strong>
							</div>
							<div>
								<label>Completed</label>
								<strong>{batchSummary.completedJobs}</strong>
							</div>
							<div>
								<label>In Flight</label>
								<strong>{batchSummary.inFlightJobs}</strong>
							</div>
							<div>
								<label>Total Saved</label>
								<strong>{bytesToLabel(batchSummary.totalSavedBytes)}</strong>
							</div>
						</div>
					</div>
					<h2>Queued Jobs</h2>
					<div className="pipe-job-list">
						{jobs.map((job) => (
							<article className="pipe-job-card" key={job.jobId}>
								<div className="pipe-job-row">
									<span className={`pipe-job-pill is-${job.status}`}>{job.status}</span>
									{job.fileName ? <strong>{job.fileName}</strong> : null}
									<code>{job.jobId}</code>
								</div>
								{job.result ? (
									<div className="pipe-metrics pipe-metrics-compact">
										<div>
											<label>Output</label>
											<strong>{bytesToLabel(job.result.outputBytes)}</strong>
										</div>
										<div>
											<label>Saved</label>
											<strong>{bytesToLabel(job.result.savedBytes)}</strong>
										</div>
										<div>
											<label>Reduction</label>
											<strong>{job.result.savedPercent.toFixed(2)}%</strong>
										</div>
										<div>
											<label>Strategy</label>
											<strong>{job.result.strategy}</strong>
										</div>
									</div>
								) : null}

								{job.error ? <p className="pipe-error">{job.error.message}</p> : null}

								{job.downloadUrl ? (
									<a className="pipe-download" href={job.downloadUrl} target="_blank" rel="noreferrer">
										Download Optimized Output
									</a>
								) : null}
							</article>
						))}
					</div>
				</section>
			) : null}

			{result ? (
				<section className="pipe-result">
					<h2>Optimization Result</h2>
					<div className="pipe-metrics">
						<div>
							<label>Input</label>
							<strong>{bytesToLabel(result.inputBytes)}</strong>
						</div>
						<div>
							<label>Output</label>
							<strong>{bytesToLabel(result.outputBytes)}</strong>
						</div>
						<div>
							<label>Saved</label>
							<strong>{bytesToLabel(result.savedBytes)}</strong>
						</div>
						<div>
							<label>Reduction</label>
							<strong>{result.savedPercent.toFixed(2)}%</strong>
						</div>
					</div>

					<div className="pipe-compare">
						<div className="pipe-preview-card">
							<header>
								<strong>Input</strong>
								<small>{result.inputFilename}</small>
							</header>
							<div className="pipe-preview">
								{result.inputKind === 'image' ? (
									<img src={result.inputUrl} alt="Original upload preview" />
								) : (
									<video src={result.inputUrl} controls preload="metadata" />
								)}
							</div>
						</div>

						<div className="pipe-preview-card">
							<header>
								<strong>Output</strong>
								<small>{result.filename}</small>
							</header>
							<div className="pipe-preview">
								{result.kind === 'image' ? (
									<img src={result.url} alt="Optimized media preview" />
								) : (
									<video src={result.url} controls preload="metadata" />
								)}
							</div>
						</div>
					</div>

					<a className="pipe-download" href={result.url} download={result.filename}>
						Download {result.filename}
					</a>
				</section>
			) : null}
		</main>
	)
}
