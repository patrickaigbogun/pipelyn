import { LocalStorageAdapter } from './local'
import { S3StorageAdapter } from './s3'

export type { StorageAdapter } from './local'
export { LocalStorageAdapter } from './local'
export { S3StorageAdapter } from './s3'

let _adapter: LocalStorageAdapter | S3StorageAdapter | null = null

/**
 * Returns the singleton storage adapter.
 * Uses S3StorageAdapter when PIPELYN_S3_BUCKET is set, otherwise LocalStorageAdapter.
 */
export function getStorageAdapter(): LocalStorageAdapter | S3StorageAdapter {
	if (_adapter) return _adapter
	_adapter = process.env.PIPELYN_S3_BUCKET
		? new S3StorageAdapter()
		: new LocalStorageAdapter()
	return _adapter
}
