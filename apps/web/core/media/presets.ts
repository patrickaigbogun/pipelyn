export type MediaPresetName = 'mobile' | 'web' | 'low-bandwidth'

export type MediaPreset = {
	name: MediaPresetName
	maxWidth: number
	imageQuality: number
	videoCrf: number
	videoBitrateKbps: number
	audioBitrateKbps: number
}

export const MEDIA_PRESETS: Record<MediaPresetName, MediaPreset> = {
	mobile: {
		name: 'mobile',
		maxWidth: 900,
		imageQuality: 78,
		videoCrf: 28,
		videoBitrateKbps: 1200,
		audioBitrateKbps: 96,
	},
	web: {
		name: 'web',
		maxWidth: 1400,
		imageQuality: 82,
		videoCrf: 24,
		videoBitrateKbps: 2400,
		audioBitrateKbps: 128,
	},
	'low-bandwidth': {
		name: 'low-bandwidth',
		maxWidth: 720,
		imageQuality: 72,
		videoCrf: 30,
		videoBitrateKbps: 900,
		audioBitrateKbps: 80,
	},
}

export function resolvePreset(input: string | undefined): MediaPreset {
	if (!input) return MEDIA_PRESETS.web
	const candidate = input as MediaPresetName
	return MEDIA_PRESETS[candidate] ?? MEDIA_PRESETS.web
}
