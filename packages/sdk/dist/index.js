// @bun
// src/index.ts
class PipelynError extends Error {
  code;
  status;
  retriable;
  cause;
  details;
  constructor(message, opts) {
    super(message);
    this.name = "PipelynError";
    this.code = opts.code;
    this.status = opts.status;
    this.retriable = Boolean(opts.retriable);
    this.cause = opts.cause;
    this.details = opts.details;
  }
}
var DEFAULT_RETRY = {
  retries: 2,
  baseDelayMs: 250,
  maxDelayMs: 2500,
  retryOnStatuses: [408, 425, 429, 500, 502, 503, 504]
};
function trimSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
function mergeRetryOptions(input) {
  if (!input)
    return { ...DEFAULT_RETRY };
  return {
    retries: Math.max(0, input.retries ?? DEFAULT_RETRY.retries),
    baseDelayMs: Math.max(1, input.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs),
    maxDelayMs: Math.max(1, input.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs),
    retryOnStatuses: input.retryOnStatuses ?? DEFAULT_RETRY.retryOnStatuses
  };
}
function toHeaders(input) {
  return new Headers(input ?? {});
}
function isAbortError(cause) {
  if (!cause || typeof cause !== "object")
    return false;
  const name = "name" in cause ? String(cause.name) : "";
  return name === "AbortError";
}
function retryDelay(attempt, retry) {
  const raw = retry.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(retry.maxDelayMs, raw + jitter);
}
async function sleep(ms, signal) {
  if (signal?.aborted) {
    throw new PipelynError("Request aborted before retry delay", {
      code: "aborted",
      retriable: false
    });
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal)
      return;
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new PipelynError("Request aborted during retry delay", {
        code: "aborted",
        retriable: false
      }));
    }, { once: true });
  });
}
function buildFile(input) {
  if (input.media instanceof File)
    return input.media;
  if (input.media instanceof Blob) {
    return new File([input.media], input.filename ?? "media.bin", {
      type: input.contentType ?? input.media.type ?? "application/octet-stream"
    });
  }
  if (input.media instanceof Uint8Array) {
    const copy = new Uint8Array(input.media);
    return new File([copy], input.filename ?? "media.bin", {
      type: input.contentType ?? "application/octet-stream"
    });
  }
  return new File([new Uint8Array(input.media)], input.filename ?? "media.bin", {
    type: input.contentType ?? "application/octet-stream"
  });
}
function parseNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function parseFilename(contentDisposition) {
  if (!contentDisposition)
    return "optimized.bin";
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "optimized.bin";
}
async function safeResponseText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
function assertKind(result, expected) {
  if (result.kind !== expected) {
    throw new PipelynError(`Expected ${expected} response but received ${result.kind}`, {
      code: "invalid-response",
      retriable: false
    });
  }
}

class PipelynClient {
  baseUrl;
  defaultPreset;
  apiKey;
  headers;
  retry;
  constructor(opts) {
    this.baseUrl = trimSlash(opts.baseUrl);
    this.defaultPreset = opts.defaultPreset ?? "web";
    this.apiKey = opts.apiKey;
    this.headers = opts.headers;
    this.retry = mergeRetryOptions(opts.retry);
  }
  baseHeaders() {
    const headers = toHeaders(this.headers);
    if (this.apiKey)
      headers.set("x-api-key", this.apiKey);
    return headers;
  }
  async fetchWithRetry(url, init) {
    let lastError = null;
    for (let attempt = 0;attempt <= this.retry.retries; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.ok)
          return res;
        const details = await safeResponseText(res);
        const retriable = this.retry.retryOnStatuses.includes(res.status);
        if (!retriable || attempt === this.retry.retries) {
          throw new PipelynError(`Request failed with status ${res.status}`, {
            code: "http",
            status: res.status,
            retriable,
            details
          });
        }
        await sleep(retryDelay(attempt, this.retry), init.signal ?? undefined);
        continue;
      } catch (cause) {
        if (cause instanceof PipelynError) {
          if (!cause.retriable || attempt === this.retry.retries)
            throw cause;
          await sleep(retryDelay(attempt, this.retry), init.signal ?? undefined);
          lastError = cause;
          continue;
        }
        if (isAbortError(cause)) {
          throw new PipelynError("Request aborted", {
            code: "aborted",
            retriable: false,
            cause
          });
        }
        const networkError = new PipelynError("Network request failed", {
          code: "network",
          retriable: true,
          cause
        });
        if (attempt === this.retry.retries)
          throw networkError;
        lastError = networkError;
        await sleep(retryDelay(attempt, this.retry), init.signal ?? undefined);
      }
    }
    throw lastError ?? new PipelynError("Request failed after retries", {
      code: "network",
      retriable: false
    });
  }
  async getPresets(signal) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/media/presets`, {
      method: "GET",
      headers: this.baseHeaders(),
      signal
    });
    return await res.json();
  }
  async optimizeImage(input) {
    const file = buildFile(input);
    const contentType = input.contentType ?? file.type;
    if (contentType && !contentType.startsWith("image/")) {
      throw new PipelynError(`Expected image media type, received ${contentType}`, {
        code: "invalid-input",
        retriable: false
      });
    }
    const result = await this.optimizeMedia({ ...input, media: file });
    assertKind(result, "image");
    return result;
  }
  async optimizeVideo(input) {
    const file = buildFile(input);
    const contentType = input.contentType ?? file.type;
    if (contentType && !contentType.startsWith("video/")) {
      throw new PipelynError(`Expected video media type, received ${contentType}`, {
        code: "invalid-input",
        retriable: false
      });
    }
    const result = await this.optimizeMedia({ ...input, media: file });
    assertKind(result, "video");
    return result;
  }
  async optimizeMedia(input) {
    const mediaFile = buildFile(input);
    const form = new FormData;
    form.set("media", mediaFile);
    form.set("preset", input.preset ?? this.defaultPreset);
    const headers = this.baseHeaders();
    headers.delete("content-type");
    const res = await this.fetchWithRetry(`${this.baseUrl}/media/optimize`, {
      method: "POST",
      body: form,
      headers,
      signal: input.signal
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return {
      bytes,
      blob: new Blob([bytes], { type: contentType }),
      filename: parseFilename(res.headers.get("content-disposition")),
      contentType,
      kind: res.headers.get("x-pipelyn-kind") ?? "image",
      preset: res.headers.get("x-pipelyn-preset") ?? this.defaultPreset,
      strategy: res.headers.get("x-pipelyn-strategy") ?? "unknown",
      inputBytes: parseNum(res.headers.get("x-pipelyn-input-bytes")),
      outputBytes: parseNum(res.headers.get("x-pipelyn-output-bytes")),
      savedBytes: parseNum(res.headers.get("x-pipelyn-saved-bytes")),
      savedPercent: parseNum(res.headers.get("x-pipelyn-saved-percent")),
      inputDurationSec: parseNum(res.headers.get("x-pipelyn-input-duration")),
      outputDurationSec: parseNum(res.headers.get("x-pipelyn-output-duration")),
      inputWidth: parseNum(res.headers.get("x-pipelyn-input-width")),
      outputWidth: parseNum(res.headers.get("x-pipelyn-output-width"))
    };
  }
  async submitJob(input) {
    const mediaFile = buildFile(input);
    const form = new FormData;
    form.set("media", mediaFile);
    form.set("preset", input.preset ?? this.defaultPreset);
    const headers = this.baseHeaders();
    headers.delete("content-type");
    const res = await this.fetchWithRetry(`${this.baseUrl}/media/jobs`, {
      method: "POST",
      body: form,
      headers,
      signal: input.signal
    });
    return await res.json();
  }
  async getJobStatus(jobId, signal) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/media/jobs/${jobId}`, {
      method: "GET",
      headers: this.baseHeaders(),
      signal
    });
    return await res.json();
  }
  async waitForJob(jobId, {
    pollIntervalMs = 1000,
    maxWaitMs = 300000,
    signal
  } = {}) {
    const deadline = Date.now() + maxWaitMs;
    while (true) {
      const status = await this.getJobStatus(jobId, signal);
      if (status.status === "done")
        return status;
      if (status.status === "failed") {
        throw new PipelynError(status.error?.message ?? "Job failed", {
          code: "http",
          retriable: false,
          details: status.error?.code
        });
      }
      if (Date.now() >= deadline) {
        throw new PipelynError(`Job ${jobId} did not complete within ${maxWaitMs}ms`, {
          code: "aborted",
          retriable: false
        });
      }
      await sleep(pollIntervalMs, signal);
    }
  }
  async getUsage(signal) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/usage`, {
      method: "GET",
      headers: this.baseHeaders(),
      signal
    });
    return await res.json();
  }
}
function createPipelynClient(opts) {
  return new PipelynClient(opts);
}
export {
  createPipelynClient,
  PipelynError,
  PipelynClient
};
