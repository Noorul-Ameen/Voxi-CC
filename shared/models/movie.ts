/** Normalized movie/cinema/showtime domain models.
 *
 * These are the ONLY movie-shaped types the frontend knows about. Upstream
 * VOX (or any future provider) responses are mapped into these models inside
 * the provider layer — never passed through raw.
 */

/** Cinema experience / auditorium format, normalized across providers. */
export type MovieFormat =
  | 'STANDARD'
  | 'MAX'
  | 'IMAX'
  | '4DX'
  | 'GOLD'
  | 'THEATRE'
  | 'KIDS'
  | 'PREMIER'
  | 'PREMIUM'
  | 'OTHER';

/** UAE media-rating classifications used by VOX. */
export type AgeRating = 'G' | 'PG' | 'PG13' | 'PG15' | '15+' | '18+' | 'TBC';

export interface Movie {
  /** Stable provider identifier (VOX slug, e.g. "spider-man-brand-new-day"). */
  id: string;
  /** Vista scheduled-film id when known (e.g. "HO00013065"), for future Connect API use. */
  vistaFilmId?: string;
  title: string;
  synopsis?: string;
  language?: string;
  subtitles?: string;
  genres: string[];
  rating?: AgeRating | string;
  runtimeMinutes?: number;
  posterUrl?: string;
  heroUrl?: string;
  cast?: string[];
  releaseDate?: string; // ISO date
  status: 'now_showing' | 'coming_soon';
  /** True only when the rating is present and family-appropriate (G/PG/PG13). */
  familySafe: boolean;
}

export interface Cinema {
  /** Provider identifier (VOX slug, e.g. "mall-of-the-emirates"). */
  id: string;
  /** Vista cinema code when known (e.g. "0002"), preserved for booking deep links. */
  vistaCinemaId?: string;
  name: string;
  address?: string;
  city?: string;
  /** Experiences advertised at this cinema. */
  formats: MovieFormat[];
  url?: string;
}

export interface Showtime {
  /** Composite genuine VOX session reference: `${vistaCinemaId}-${vistaSessionId}`. */
  id: string;
  vistaCinemaId: string;
  vistaSessionId: string;
  movieId: string;
  cinemaId?: string;
  cinemaName: string;
  /** Local Dubai calendar date (YYYY-MM-DD) the session belongs to. */
  date: string;
  /** Display time exactly as published by VOX (e.g. "11:30pm"). */
  timeLabel: string;
  /** Minutes since midnight (Dubai local) for sorting/filtering; sessions past
   *  midnight that VOX lists under the previous day keep values >= 1440. */
  minutesFromMidnight: number;
  format: MovieFormat;
  /** Raw format label as published (e.g. "THEATRE PODS in IMAX"). */
  formatLabel: string;
  /** Official VOX booking deep link for this genuine session. */
  bookingUrl: string;
}

export interface MovieWithShowtimes extends Movie {
  showtimes: Showtime[];
}
