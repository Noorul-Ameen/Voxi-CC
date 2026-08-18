/** VOX UAE discovery provider — movies, cinemas, showtimes.
 *
 * Data source: genuine server-rendered pages of uae.voxcinemas.com (see
 * docs/VOX_API.md for the full endpoint catalogue). All IDs (movie slugs,
 * Vista cinema codes, Vista session ids) are preserved exactly as VOX
 * publishes them. Nothing is invented: empty upstream → empty result;
 * failed upstream → thrown UpstreamError surfaced as a structured ApiError.
 */

import type {
  Cinema,
  FilterState,
  Movie,
  MovieWithShowtimes,
  ProviderStatus,
  Showtime,
} from '@shared/models';
import { fuzzySearch, nowInDubai, toVoxDateParam } from '@shared/utils';
import type {
  CinemaProvider,
  HealthCheckable,
  MovieDiscoveryProvider,
  ShowtimeProvider,
} from '../types';
import type { VoxClient } from './client';
import {
  isFamilySafeRating,
  parseAvailableDates,
  parseCinemaShowtimesPage,
  parseCinemasPage,
  parseMovieDetail,
  parseMovieListPage,
  parseMoviePageShowtimes,
  normalizeFormat,
} from './parsers';

const LIST_TTL = 900; // 15 min for catalogs
const SHOWTIME_TTL = 300; // 5 min for showtimes

export class VoxDiscoveryProvider
  implements MovieDiscoveryProvider, CinemaProvider, ShowtimeProvider, HealthCheckable
{
  constructor(
    private readonly client: VoxClient,
    /** Injectable clock — tests pin this to the fixture capture instant. */
    private readonly nowFn: () => Date = () => new Date(),
  ) {}

  /* ── Movies ── */

  async listMovies(status: Movie['status'] = 'now_showing'): Promise<Movie[]> {
    const path = status === 'now_showing' ? '/movies/whatson' : '/movies/comingsoon';
    const html = await this.client.getPage(path, LIST_TTL);
    return parseMovieListPage(html, status);
  }

  async getMovie(movieId: string): Promise<Movie | undefined> {
    if (!/^[a-z0-9-]+$/.test(movieId)) return undefined;
    const html = await this.client.getPage(`/movies/${movieId}`, LIST_TTL);
    const detail = parseMovieDetail(html, movieId);
    return detail;
  }

  /* ── Cinemas ── */

  async listCinemas(): Promise<Cinema[]> {
    const html = await this.client.getPage('/cinemas', LIST_TTL);
    return parseCinemasPage(html).map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      formats: [],
      url: `https://uae.voxcinemas.com/cinemas/${c.id}`,
    }));
  }

  async getCinema(cinemaId: string): Promise<Cinema | undefined> {
    const cinemas = await this.listCinemas();
    return cinemas.find((c) => c.id === cinemaId);
  }

  /** Fuzzy-resolve a cinema mention ("MOE", "Mall of the Emirates", "Deira"). */
  async resolveCinema(mention: string): Promise<Cinema | undefined> {
    const cinemas = await this.listCinemas();
    const aliases: Record<string, string> = {
      moe: 'mall-of-the-emirates',
      'mall of emirates': 'mall-of-the-emirates',
      dfc: 'dubai-festival-city-mall',
      'festival city': 'dubai-festival-city-mall',
      mirdif: 'city-centre-mirdif',
      deira: 'city-centre-deira',
      burjuman: 'burjuman',
      'yas mall': 'yas-mall-abu-dhabi',
    };
    const aliased = aliases[mention.toLowerCase().trim()];
    if (aliased) {
      const hit = cinemas.find((c) => c.id === aliased);
      if (hit) return hit;
    }
    const matches = fuzzySearch(mention, cinemas, (c) => [c.name, c.id.replaceAll('-', ' ')], 0.5);
    return matches[0]?.item;
  }

  /* ── Showtimes ── */

  async getShowtimesForMovie(movieId: string, date: string): Promise<Showtime[]> {
    if (!/^[a-z0-9-]+$/.test(movieId)) return [];
    const today = nowInDubai(this.nowFn()).date;
    const path =
      date === today
        ? `/movies/${movieId}`
        : `/movies/${movieId}?d=${toVoxDateParam(date)}`;
    const html = await this.client.getPage(path, SHOWTIME_TTL);
    const showtimes = parseMoviePageShowtimes(html, movieId, date);
    const cinemas = await this.listCinemas().catch(() => []);
    return showtimes.map((st) => ({
      ...st,
      cinemaId: matchCinemaId(st.cinemaName, cinemas),
    }));
  }

  async getShowtimesForCinema(cinemaId: string, date: string): Promise<Showtime[]> {
    if (!/^[a-z0-9-]+$/.test(cinemaId)) return [];
    const today = nowInDubai(this.nowFn()).date;
    const path =
      date === today
        ? `/showtimes/${cinemaId}`
        : `/showtimes?c=${cinemaId}&d=${toVoxDateParam(date)}`;
    const html = await this.client.getPage(path, SHOWTIME_TTL);
    const parsed = parseCinemaShowtimesPage(html);
    return parsed
      .flatMap((movie) =>
        movie.showtimes.map((st) => ({ ...st, date, cinemaId })),
      )
      .sort((a, b) => a.minutesFromMidnight - b.minutesFromMidnight);
  }

  async getAvailableDates(movieId: string): Promise<string[]> {
    if (!/^[a-z0-9-]+$/.test(movieId)) return [];
    const html = await this.client.getPage(`/movies/${movieId}`, SHOWTIME_TTL);
    return parseAvailableDates(html, nowInDubai(this.nowFn()).date);
  }

  /* ── Filtered discovery (drives movie cards + conversation) ── */

  async discover(filters: FilterState): Promise<MovieWithShowtimes[]> {
    // Cinema-scoped discovery uses the per-cinema page: one upstream fetch.
    if (filters.cinemaId) {
      return this.discoverAtCinema(filters);
    }
    let movies = await this.listMovies('now_showing');
    movies = applyMovieFilters(movies, filters);

    // Showtime-level constraints require per-movie showtime data. To keep
    // upstream traffic bounded we only expand showtimes for the top matches.
    const needShowtimes =
      filters.date !== undefined || filters.format !== undefined || filters.timeFromMinutes !== undefined;
    const date = filters.date ?? nowInDubai(this.nowFn()).date;
    const expand = needShowtimes ? movies.slice(0, 8) : [];
    const expanded = new Map<string, Showtime[]>();
    await Promise.all(
      expand.map(async (m) => {
        try {
          expanded.set(m.id, await this.getShowtimesForMovie(m.id, date));
        } catch {
          // Leave showtimes unknown for this movie; do not fabricate.
        }
      }),
    );

    let result: MovieWithShowtimes[] = movies.map((m) => ({
      ...m,
      showtimes: filterShowtimes(expanded.get(m.id) ?? [], filters),
    }));
    if (needShowtimes) {
      result = result.filter((m) => !expanded.has(m.id) || m.showtimes.length > 0);
      // Movies we didn't expand can't be verified for the date/format — drop
      // them only when a hard showtime constraint exists.
      result = result.filter((m) => expanded.has(m.id));
    }
    return result;
  }

  private async discoverAtCinema(filters: FilterState): Promise<MovieWithShowtimes[]> {
    const cinemaId = filters.cinemaId!;
    const date = filters.date ?? nowInDubai(this.nowFn()).date;
    const [dayMovies, catalog] = await Promise.all([
      this.getCinemaDayMovies(cinemaId, date),
      this.listMovies('now_showing').catch(() => [] as Movie[]),
    ]);
    const catalogById = new Map(catalog.map((m) => [m.id, m]));
    let result: MovieWithShowtimes[] = dayMovies.map((dm) => {
      const cat = catalogById.get(dm.movieId);
      return {
        id: dm.movieId,
        vistaFilmId: dm.vistaFilmId ?? cat?.vistaFilmId,
        title: dm.title,
        language: dm.language ?? cat?.language,
        genres: cat?.genres ?? [],
        rating: dm.rating ?? cat?.rating,
        runtimeMinutes: dm.runtimeMinutes,
        posterUrl: cat?.posterUrl,
        heroUrl: dm.heroUrl,
        status: 'now_showing' as const,
        familySafe: isFamilySafeRating(dm.rating ?? cat?.rating),
        showtimes: filterShowtimes(
          dm.showtimes.map((st) => ({ ...st, date, cinemaId })),
          filters,
        ),
      };
    });
    result = result.filter((m) => m.showtimes.length > 0);
    return applyMovieFilters(result, filters) as MovieWithShowtimes[];
  }

  private async getCinemaDayMovies(cinemaId: string, date: string) {
    const today = nowInDubai(this.nowFn()).date;
    const path =
      date === today
        ? `/showtimes/${cinemaId}`
        : `/showtimes?c=${cinemaId}&d=${toVoxDateParam(date)}`;
    const html = await this.client.getPage(path, SHOWTIME_TTL);
    return parseCinemaShowtimesPage(html);
  }

  /* ── Health ── */

  async checkHealth(): Promise<ProviderStatus> {
    const start = Date.now();
    try {
      const movies = await this.listMovies('now_showing');
      return {
        provider: 'vox-discovery',
        health: movies.length > 0 ? 'ok' : 'degraded',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        detail: `${movies.length} movies now showing`,
      };
    } catch {
      return {
        provider: 'vox-discovery',
        health: 'unavailable',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

/* ── Pure filter helpers (unit tested) ── */

export function applyMovieFilters<T extends Movie>(movies: T[], filters: FilterState): T[] {
  let out = movies;
  if (filters.query) {
    const matches = fuzzySearch(filters.query, out, (m) => [m.title, m.id.replaceAll('-', ' ')]);
    out = matches.map((m) => m.item);
  }
  if (filters.language) {
    const lang = filters.language.toLowerCase();
    out = out.filter((m) => m.language?.toLowerCase().includes(lang));
  }
  if (filters.genre) {
    const g = filters.genre.toLowerCase();
    out = out.filter(
      (m) => m.genres.length === 0 || m.genres.some((x) => x.toLowerCase().includes(g)),
    );
  }
  if (filters.rating) {
    const r = filters.rating.toUpperCase();
    out = out.filter((m) => (m.rating ?? '').toUpperCase() === r);
  }
  if (filters.familySafe) {
    // Family-safe uses genuine classification data only — a movie without a
    // known-safe rating is excluded, whatever its genre.
    out = out.filter((m) => m.familySafe);
  }
  return out;
}

export function filterShowtimes(showtimes: Showtime[], filters: FilterState): Showtime[] {
  let out = showtimes;
  if (filters.format) {
    const f = filters.format;
    out = out.filter((st) => st.format === f || normalizeFormat(st.formatLabel) === f);
  }
  if (filters.timeFromMinutes !== undefined) {
    const t = filters.timeFromMinutes;
    out = out.filter((st) => st.minutesFromMidnight >= t);
  }
  if (filters.cinemaId) {
    out = out.filter((st) => !st.cinemaId || st.cinemaId === filters.cinemaId);
  }
  return out;
}

function matchCinemaId(cinemaName: string, cinemas: Cinema[]): string | undefined {
  if (cinemas.length === 0) return undefined;
  const matches = fuzzySearch(cinemaName, cinemas, (c) => [c.name], 0.7);
  return matches[0]?.item.id;
}
