export type MediaPresetName = 'mobile' | 'web' | 'low-bandwidth';
type MediaKind = 'image' | 'video';
export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';
export type JobResultMeta = {
    kind: MediaKind;
    strategy: string;
    contentType: string;
    filename: string;
    outputBytes: number;
    savedBytes: number;
    savedPercent: number;
    inputDurationSec: number | undefined;
    outputDurationSec: number | undefined;
    inputWidth: number | undefined;
    outputWidth: number | undefined;
};
export type CreateJobResponse = {
    jobId: string;
    status: JobStatus;
    createdAt: number;
};
export type JobStatusResponse = {
    jobId: string;
    status: JobStatus;
    preset: MediaPresetName;
    filename: string;
    inputBytes: number;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    result?: JobResultMeta;
    error?: {
        message: string;
        code: string;
    };
    downloadUrl: string | null;
};
export type UsageSnapshot = {
    totalJobs: number;
    totalInputBytes: number;
    totalOutputBytes: number;
    totalSavedBytes: number;
};
export type PipelynErrorCode = 'aborted' | 'network' | 'http' | 'invalid-input' | 'invalid-response';
export type MediaPreset = {
    name: MediaPresetName;
    maxWidth: number;
    imageQuality: number;
    videoCrf: number;
    videoBitrateKbps: number;
    audioBitrateKbps: number;
};
export type PresetsResponse = {
    defaultPreset: MediaPresetName;
    presets: MediaPreset[];
};
export type OptimizeMediaInput = {
    media: File | Blob | Uint8Array | ArrayBuffer;
    preset?: MediaPresetName;
    filename?: string;
    contentType?: string;
    signal?: AbortSignal;
};
export type OptimizeMediaResult = {
    bytes: Uint8Array;
    blob: Blob;
    filename: string;
    contentType: string;
    kind: MediaKind;
    preset: MediaPresetName;
    strategy: string;
    inputBytes: number;
    outputBytes: number;
    savedBytes: number;
    savedPercent: number;
    inputDurationSec: number;
    outputDurationSec: number;
    inputWidth: number;
    outputWidth: number;
};
export type PipelynClientOptions = {
    baseUrl: string;
    defaultPreset?: MediaPresetName;
    /**
     * API key sent as `x-api-key` header on every request.
     * Only required when the server has `PIPELYN_API_KEYS` configured.
     */
    apiKey?: string;
    headers?: HeadersInit;
    retry?: Partial<PipelynRetryOptions>;
};
export type PipelynRetryOptions = {
    retries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryOnStatuses: number[];
};
export type PipelynErrorOptions = {
    code: PipelynErrorCode;
    status?: number;
    retriable?: boolean;
    cause?: unknown;
    details?: string;
};
export declare class PipelynError extends Error {
    readonly code: PipelynErrorCode;
    readonly status?: number;
    readonly retriable: boolean;
    readonly cause?: unknown;
    readonly details?: string;
    constructor(message: string, opts: PipelynErrorOptions);
}
export declare class PipelynClient {
    private readonly baseUrl;
    private readonly defaultPreset;
    private readonly apiKey?;
    private readonly headers?;
    private readonly retry;
    constructor(opts: PipelynClientOptions);
    /** Build base headers, injecting x-api-key when an apiKey is configured. */
    private baseHeaders;
    private fetchWithRetry;
    getPresets(signal?: AbortSignal): Promise<PresetsResponse>;
    optimizeImage(input: OptimizeMediaInput): Promise<OptimizeMediaResult>;
    optimizeVideo(input: OptimizeMediaInput): Promise<OptimizeMediaResult>;
    optimizeMedia(input: OptimizeMediaInput): Promise<OptimizeMediaResult>;
    /**
     * Submit a media file for async optimization and return immediately with a job ID.
     */
    submitJob(input: OptimizeMediaInput): Promise<CreateJobResponse>;
    /**
     * Poll for the status of a previously submitted job.
     */
    getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatusResponse>;
    /**
     * Poll until the job reaches a terminal state ("done" or "failed"), then
     * return the final status response. Throws if the job fails, or if
     * `maxWaitMs` is exceeded.
     */
    waitForJob(jobId: string, { pollIntervalMs, maxWaitMs, signal, }?: {
        pollIntervalMs?: number;
        maxWaitMs?: number;
        signal?: AbortSignal;
    }): Promise<JobStatusResponse>;
    /**
     * Retrieve the server-side usage snapshot (total jobs processed, bytes saved, etc).
     */
    getUsage(signal?: AbortSignal): Promise<UsageSnapshot>;
}
export declare function createPipelynClient(opts: PipelynClientOptions): PipelynClient;
export {};
