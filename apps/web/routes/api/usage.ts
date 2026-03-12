import type { Elysia } from 'elysia'
import { usageCounter } from '../../core/usage'

export default function usage<const App extends Elysia>(api: App) {
	return api.get('/usage', () => usageCounter.snapshot())
}
