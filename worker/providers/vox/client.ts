/** HTTP client for uae.voxcinemas.com with KV caching, timeouts and
 *  bounded retries. Keeps request volume to VOX low and failure handling
 *  uniform. Never logs credentials (none are used for public discovery). */

import type { ApiError } from '@shared/models';

export interface VoxClientOptions {
  baseUrl: string;
  cache?: KVNamespace;
  /** seconds */
  cacheTtl?: number;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
  /** Injectable fetch (tests / alternative transports). Defaults to global fetch. */
  fetcher?: typeof fetch;
}

export class UpstreamError extends Error {
  readonly apiError: ApiError;
  constructor(apiError: ApiError) {
    super(apiError.message);
    this.apiError = apiError;
  }
}

const DEFAULTS = {
  cacheTtl: 300, // 5 minutes — showtimes freshness vs. politeness to VOX
  timeoutMs: 12_000,
  retries: 1,
  // Empty string = do not set a User-Agent header (the runtime default is
  // used). Override via VOX_USER_AGENT when an environment requires it.
    userAgent: 'VoxConversationalCommerce/1.0 (+https://github.com/Noorul-Ameen/Voxi-CC)',
};

export class VoxClient {
  private readonly opts: Required<Omit<VoxClientOptions, 'cache' | 'fetcher'>> & {
    cache?: KVNamespace;
    fetcher?: typeof fetch;
  };
  /** Rolling window of recent upstream failures (for monitoring). */
  private static recentFailures: { at: string; url: string; code: string }[] = [];

  constructor(options: VoxClientOptions) {
    this.opts = { ...DEFAULTS, ...options };
  }

  static getRecentFailures(): { at: string; url: string; code: string }[] {
    return VoxClient.recentFailures.slice(-20);
  }

  private recordFailure(url: string, code: string): void {
    VoxClient.recentFailures.push({ at: new Date().toISOString(), url, code });
    if (VoxClient.recentFailures.length > 50) {
      VoxClient.recentFailures = VoxClient.recentFailures.slice(-50);
    }
  }

  /** Fetch an HTML page (cache-first). `path` must start with '/'. */
  async getPage(path: string, ttlSeconds?: number): Promise<string> {
    const url = `${this.opts.baseUrl}${path}`;
    const cacheKey = `vox:page:${path}`;
    const ttl = ttlSeconds ?? this.opts.cacheTtl;

    if (this.opts.cache) {
      const cached = await this.opts.cache.get(cacheKey);
      if (cached !== null) return cached;
    }

    let lastError: ApiError | undefined;
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      try {
        const headers: Record<string, string> = {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en',
        };
        if (this.opts.userAgent) headers['user-agent'] = this.opts.userAgent;
        const doFetch = this.opts.fetcher ?? fetch;
        const res = await doFetch(url, {
          headers,
          signal: AbortSignal.timeout(this.opts.timeoutMs),
          redirect: 'follow',
        });
        if (res.status === 404) {
          throw new UpstreamError({
            code: 'NOT_FOUND',
            message: `VOX page not found: ${path}`,
            retryable: false,
            provider: 'vox',
          });
        }
        if (!res.ok) {
          lastError = {
            code: 'UPSTREAM_UNAVAILABLE',
            message: `VOX responded ${res.status} for ${path}`,
            retryable: res.status >= 500 || res.status === 429,
            provider: 'vox',
          };
          if (!lastError.retryable) break;
          continue;
        }
        const text = await res.text();
        if (text.length < 500 || !/<html/i.test(text)) {
          lastError = {
            code: 'UPSTREAM_INVALID_RESPONSE',
            message: `VOX returned an implausible page for ${path}`,
            retryable: true,
            provider: 'vox',
          };
          continue;
        }
        if (this.opts.cache) {
          // KV minimum TTL is 60s.
          await this.opts.cache.put(cacheKey, text, { expirationTtl: Math.max(60, ttl) });
        }
        return text;
      } catch (err) {
        if (err instanceof UpstreamError) {
          this.recordFailure(path, err.apiError.code);
          throw err;
        }
        const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
        lastError = {
          code: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
          message: isTimeout
            ? `VOX request timed out for ${path}`
            : `VOX request failed for ${path}`,
          retryable: true,
          provider: 'vox',
        };
      }
    }
    const apiError = lastError ?? {
      code: 'UPSTREAM_UNAVAILABLE' as const,
      message: `VOX request failed for ${path}`,
      retryable: true,
      provider: 'vox',
    };
    this.recordFailure(path, apiError.code);
    throw new UpstreamError(apiError);
  }
}
