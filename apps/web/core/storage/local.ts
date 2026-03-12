import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'

export interface StorageAdapter {
	put(key: string, data: Uint8Array, contentType: string): Promise<void>
	get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>
	delete(key: string): Promise<void>
	/** Optional: generate a time-limited presigned download URL */
	presignedUrl?(key: string, expiresInSeconds: number): string | Promise<string>
}

const OUTPUT_DIR =
	process.env.PIPELYN_OUTPUT_DIR ?? path.join(process.cwd(), '.pipelyn-store')

export class LocalStorageAdapter implements StorageAdapter {
	private readonly baseDir: string

	constructor(baseDir?: string) {
		this.baseDir = baseDir ?? OUTPUT_DIR
	}

	private resolve(key: string): string {
		// Sanitize key: strip leading slash, prevent path traversal
		const safe = key
			.replace(/\.\./g, '__')
			.replace(/^\/+/, '')
		return path.join(this.baseDir, safe)
	}

	async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
		const filePath = this.resolve(key)
		await mkdir(path.dirname(filePath), { recursive: true })
		await writeFile(filePath, data)
		// Persist content-type as sidecar for accurate retrieval
		await writeFile(`${filePath}.meta`, contentType, 'utf-8')
	}

	async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
		try {
			const filePath = this.resolve(key)
			const [raw, contentType] = await Promise.all([
				readFile(filePath),
				readFile(`${filePath}.meta`, 'utf-8').catch(() => 'application/octet-stream'),
			])
			return { data: new Uint8Array(raw), contentType }
		} catch {
			return null
		}
	}

	async delete(key: string): Promise<void> {
		const filePath = this.resolve(key)
		await Promise.allSettled([unlink(filePath), unlink(`${filePath}.meta`)])
	}
}
