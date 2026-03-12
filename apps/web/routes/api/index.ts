import { Elysia } from 'elysia'
import { composeRoutes } from '@dex/router'

import health from './health'
import media from './media'
import jobs from './jobs'
import usage from './usage'

/**
 * Register API routes in a single compose step.
 */
export function apiRoutes() {
	return <const App extends Elysia>(app: App) => {
		return composeRoutes(app, [
			health,
			media,
			jobs,
			usage,
		])
	}
}
