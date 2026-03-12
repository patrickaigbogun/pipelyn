import type { StorageAdapter } from './local'

/**
 * S3-compatible storage adapter backed by Bun.S3Client.
 *
 * Required env vars:
 *   PIPELYN_S3_BUCKET          — bucket name
 *   PIPELYN_S3_ACCESS_KEY_ID   — AWS or compatible access key
 *   PIPELYN_S3_SECRET_ACCESS_KEY — AWS or compatible secret
 *
 * Optional env vars:
 *   PIPELYN_S3_REGION          — region (default: us-east-1)
 *   PIPELYN_S3_ENDPOINT        — endpoint URL for S3-compatible APIs (e.g. MinIO, R2)
 */
export class S3StorageAdapter implements StorageAdapter {
	private readonly client: InstanceType<typeof Bun.S3Client>
	private readonly bucket: string

	constructor() {
		this.bucket = process.env.PIPELYN_S3_BUCKET!
		this.client = new Bun.S3Client({
			bucket: this.bucket,
			region: process.env.PIPELYN_S3_REGION ?? 'us-east-1',
			accessKeyId: process.env.PIPELYN_S3_ACCESS_KEY_ID,
			secretAccessKey: process.env.PIPELYN_S3_SECRET_ACCESS_KEY,
			endpoint: process.env.PIPELYN_S3_ENDPOINT,
		})
	}

	async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
		await this.client.write(key, data, { type: contentType })
	}

	async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
		try {
			const file = this.client.file(key)
			const data = new Uint8Array(await file.arrayBuffer())
			return {
				data,
				contentType: file.type ?? 'application/octet-stream',
			}
		} catch {
			return null
		}
	}

	async delete(key: string): Promise<void> {
		await this.client.unlink(key)
	}

	presignedUrl(key: string, expiresInSeconds: number): string {
		return this.client.presign(key, { expiresIn: expiresInSeconds })
	}
}
