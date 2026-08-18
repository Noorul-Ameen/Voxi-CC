/** Parser tests run against GENUINE captured VOX pages (tests/fixtures/vox). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isFamilySafeRating,
  normalizeFormat,
  parseAvailableDates,
  parseCinemaShowtimesPage,
  parseCinemasPage,
  parseMovieDetail,
  parseMovieListPage,
  parseMoviePageShowtimes,
  vistaFilmIdFromAsset,
} from '@worker/providers/vox/parsers';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'vox');
const load = (f: string) => readFileSync(join(dir, f), 'utf8');

describe('parseMovieListPage', () => {
  const movies = parseMovieListPage(load('movies-whatson.html'), 'now_showing');
  it('extracts all movie cards', () => {
    expect(movies.length).toBeGreaterThan(30);
  });
  it('extracts slug, title, rating, language, poster and Vista film id', () => {
    const spidey = movies.find((m) => m.id === 'spider-man-brand-new-day');
    expect(spidey).toBeDefined();
    expect(spidey!.title).toBe('Spider-Man: Brand New Day');
    expect(spidey!.rating).toBe('PG13');
    expect(spidey!.language).toBe('English');
    expect(spidey!.posterUrl).toMatch(/^https:\/\/assets\.voxcinemas\.com\/posters\//);
    expect(spidey!.vistaFilmId).toBe('HO00013065');
  });
  it('parses the coming-soon page too', () => {
    const coming = parseMovieListPage(load('movies-comingsoon.html'), 'coming_soon');
    expect(coming.length).toBeGreaterThan(20);
    expect(coming.every((m) => m.status === 'coming_soon')).toBe(true);
  });
  it('returns [] for non-catalog HTML instead of inventing movies', () => {
    expect(parseMovieListPage('<html><body>maintenance</body></html>', 'now_showing')).toEqual([]);
  });
});

describe('parseMovieDetail', () => {
  it('extracts JSON-LD metadata', () => {
    const m = parseMovieDetail(load('movie-spider-man-brand-new-day.html'), 'spider-man-brand-new-day')!;
    expect(m.title).toBe('Spider-Man: Brand New Day');
    expect(m.rating).toBe('PG13');
    expect(m.runtimeMinutes).toBe(145);
    expect(m.genres).toContain('Action');
    expect(m.language).toBe('English');
    expect(m.synopsis).toMatch(/BRAND NEW DAY/);
    expect(m.cast).toContain('Tom Holland');
    expect(m.familySafe).toBe(true);
  });
  it('returns undefined for pages without movie content', () => {
    expect(parseMovieDetail('<html><body>404</body></html>', 'x')).toBeUndefined();
  });
});

describe('parseMoviePageShowtimes', () => {
  const showtimes = parseMoviePageShowtimes(
    load('movie-spider-man-brand-new-day.html'),
    'spider-man-brand-new-day',
    '2026-08-18',
  );
  it('extracts sessions across cinemas with genuine Vista ids', () => {
    expect(showtimes.length).toBeGreaterThan(30);
    for (const st of showtimes) {
      expect(st.id).toMatch(/^\d+-\d+$/);
      expect(st.bookingUrl).toBe(`https://uae.voxcinemas.com/booking/${st.id}`);
      expect(st.timeLabel).toMatch(/^\d{1,2}:\d{2}(am|pm)$/);
    }
  });
  it('groups by cinema with real names', () => {
    const cinemas = new Set(showtimes.map((s) => s.cinemaName));
    expect(cinemas.has('Mall of the Emirates')).toBe(true);
  });
  it('normalizes formats', () => {
    const formats = new Set(showtimes.map((s) => s.format));
    expect(formats.has('MAX')).toBe(true);
  });
  it('sorts post-midnight sessions after evening ones', () => {
    const sorted = [...showtimes].sort((a, b) => a.minutesFromMidnight - b.minutesFromMidnight);
    expect(showtimes).toEqual(sorted);
    const postMidnight = showtimes.filter((s) => s.timeLabel.includes('am') && s.minutesFromMidnight >= 1440);
    for (const st of postMidnight) {
      expect(st.minutesFromMidnight).toBeGreaterThan(1380); // after 11pm slot
    }
  });
});

describe('parseAvailableDates', () => {
  it('extracts the date navigation incl. today', () => {
    const dates = parseAvailableDates(load('movie-spider-man-brand-new-day.html'), '2026-08-18');
    expect(dates).toContain('2026-08-18');
    expect(dates).toContain('2026-08-19');
    expect(dates.length).toBeGreaterThanOrEqual(8);
  });
});

describe('parseCinemasPage', () => {
  const cinemas = parseCinemasPage(load('cinemas.html'));
  it('extracts the full cinema directory', () => {
    expect(cinemas.length).toBeGreaterThanOrEqual(20);
    const moe = cinemas.find((c) => c.id === 'mall-of-the-emirates');
    expect(moe?.name).toBe('Mall of the Emirates');
    expect(moe?.address).toMatch(/Mall Of Emirates/i);
  });
});

describe('parseCinemaShowtimesPage', () => {
  const dayMovies = parseCinemaShowtimesPage(load('showtimes-mall-of-the-emirates.html'));
  it('extracts per-movie blocks with sessions', () => {
    expect(dayMovies.length).toBeGreaterThan(4);
    const spidey = dayMovies.find((m) => m.movieId === 'spider-man-brand-new-day');
    expect(spidey).toBeDefined();
    expect(spidey!.title).toBe('Spider-Man: Brand New Day');
    expect(spidey!.showtimes.length).toBeGreaterThan(0);
    expect(spidey!.showtimes[0]!.vistaCinemaId).toBe('0002');
  });
  it('extracts runtime and rating tags', () => {
    const spidey = dayMovies.find((m) => m.movieId === 'spider-man-brand-new-day')!;
    expect(spidey.runtimeMinutes).toBe(145);
    expect(spidey.rating).toBe('PG13');
  });
});

describe('helpers', () => {
  it('family-safe uses genuine classification only', () => {
    expect(isFamilySafeRating('G')).toBe(true);
    expect(isFamilySafeRating('PG')).toBe(true);
    expect(isFamilySafeRating('PG13')).toBe(true);
    expect(isFamilySafeRating('PG15')).toBe(false);
    expect(isFamilySafeRating('15+')).toBe(false);
    expect(isFamilySafeRating('18+')).toBe(false);
    expect(isFamilySafeRating(undefined)).toBe(false); // unknown ≠ safe
  });
  it('normalizes format labels', () => {
    expect(normalizeFormat('THEATRE PODS in IMAX')).toBe('IMAX');
    expect(normalizeFormat('Kids')).toBe('KIDS');
    expect(normalizeFormat('MAX')).toBe('MAX');
    expect(normalizeFormat('Something Else')).toBe('OTHER');
  });
  it('extracts Vista film ids from asset urls', () => {
    expect(vistaFilmIdFromAsset('https://assets.voxcinemas.com/posters/P_HO00013065_1782227665332.jpg')).toBe('HO00013065');
    expect(vistaFilmIdFromAsset('https://assets.voxcinemas.com/heroes/B_HO00013065_1.jpg')).toBe('HO00013065');
    expect(vistaFilmIdFromAsset(undefined)).toBeUndefined();
  });
});
