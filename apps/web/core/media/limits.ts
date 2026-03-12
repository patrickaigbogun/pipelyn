const MB = 1024 * 1024

export const PIPELYN_DEFAULT_MAX_INPUT_BYTES = 120 * MB
export const PIPELYN_MAX_INPUT_BYTES = Number(
	process.env.PIPELYN_MAX_INPUT_BYTES ?? PIPELYN_DEFAULT_MAX_INPUT_BYTES
)

export function maxInputMegabytes(): number {
	return Math.round(PIPELYN_MAX_INPUT_BYTES / MB)
}
