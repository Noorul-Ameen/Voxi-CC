/** Typed client for the internal Worker API. The UI never talks to VOX or
 *  ElevenLabs REST endpoints directly — only to /api/*. */

import type {
  ApiError,
  Cinema,
  ConversationRequest,
  ConversationResponse,
  Movie,
  MovieWithShowtimes,
  Showtime,
  VoiceSessionGrant,
} from '@shared/models';

export class ApiClientError extends Error {
  constructor(readonly apiError: ApiError, readonly status: number) {
    super(apiError.message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const timeout = err instanceof DOMException && err.name === 'TimeoutError';
    throw new ApiClientError(
      {
        code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        message: timeout ? 'The request timed out.' : 'Network error — please check your connection.',
        retryable: true,
      },
      0,
    );
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const error = (body as { error?: ApiError } | undefined)?.error ?? {
      code: 'INTERNAL' as const,
      message: 'Unexpected server error.',
      retryable: true,
    };
    throw new ApiClientError(error, res.status);
  }
  return body as T;
}

export const api = {
  getCinemas: () => request<{ cinemas: Cinema[] }>('/api/cinemas'),

  getMovies: (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => !!e[1]),
    );
    return request<{ movies: MovieWithShowtimes[] }>(`/api/movies?${qs}`);
  },

  getMovie: (movieId: string) =>
    request<{ movie: Movie; availableDates: string[] }>(`/api/movies/${encodeURIComponent(movieId)}`),

  getShowtimes: (params: { movieId?: string; cinemaId?: string; date?: string }) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => !!e[1]),
    );
    return request<{ showtimes: Showtime[]; date: string }>(`/api/showtimes?${qs}`);
  },

  sendConversation: (req: ConversationRequest) =>
    request<ConversationResponse>('/api/conversation', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  createVoiceSession: () =>
    request<VoiceSessionGrant>('/api/voice/session', { method: 'POST', body: '{}' }),

  getHealth: () => request<{ status: string; environment: string }>('/api/health'),
};
