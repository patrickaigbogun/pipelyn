import { Elysia } from 'elysia'

function parseApiKeys(): Set<string> | null {
	const raw = process.env.PIPELYN_API_KEYS
	if (!raw) return null
	const keys = raw
		.split(',')
		.map((k) => k.trim())
		.filter(Boolean)
	return keys.length > 0 ? new Set(keys) : null
}

const API_KEYS: Set<string> | null = parseApiKeys()

export function isAuthEnabled(): boolean {
	return API_KEYS !== null
}

function extractBearer(auth: string | null): string | null {
	if (!auth?.startsWith('Bearer ')) return null
	return auth.slice(7).trim() || null
}

function requestApiKey(request: Request): string | null {
	return (
		request.headers.get('x-api-key') ??
		extractBearer(request.headers.get('authorization'))
	)
}

/**
 * Elysia plugin that enforces API-key authentication on all routes except
 * those whose paths end with `/health`. Only active when PIPELYN_API_KEYS
 * env var is set (comma-separated list of valid keys).
 *
 * Clients must supply the key via one of:
 *   Authorization: Bearer <key>
 *   x-api-key: <key>
 */
export const authPlugin = new Elysia({ name: 'pipelyn-auth' }).onBeforeHandle(
	{ as: 'global' },
	({ request, set }) => {
		if (!isAuthEnabled()) return
		const url = new URL(request.url)
		// Health check is always public
		if (url.pathname.endsWith('/health')) return
		const key = requestApiKey(request)
		if (!key || !API_KEYS!.has(key)) {
			set.status = 401
			return { error: 'Unauthorized: valid API key required', code: 'unauthorized' }
		}
	}
)
