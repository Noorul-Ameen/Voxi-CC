export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_INVALID_RESPONSE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** Whether the client can meaningfully retry. */
  retryable: boolean;
  /** Which provider/capability failed, when relevant. */
  provider?: string;
}

export interface ProviderError extends ApiError {
  provider: string;
}

export type ProviderHealth = 'ok' | 'degraded' | 'unavailable' | 'not_configured';

export interface ProviderStatus {
  provider: string;
  health: ProviderHealth;
  /** ms latency of the last check, if performed. */
  latencyMs?: number;
  checkedAt: string;
  detail?: string;
}
