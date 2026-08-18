/** Parsers for VOX UAE server-rendered pages.
 *
 * uae.voxcinemas.com exposes no public JSON API; its pages are fully
 * server-rendered with stable, semantic markup (article.movie-summary,
 * ol.showtimes, li[data-id="{vistaCinemaId}-{vistaSessionId}"], JSON-LD movie
 * metadata). These parsers extract that structure into normalized models and
 * are deliberately tolerant: a block that fails to parse is skipped, and the
 * caller treats an implausibly empty result as UPSTREAM_INVALID_RESPONSE
 * rather than fabricating data. See docs/VOX_API.md.
 */

import type { AgeRating, Movie, MovieFormat, Showtime } from '@shared/models';
import { parseTimeLabel } from '@shared/utils';

const decode = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

const KNOWN_RATINGS = new Set(['G', 'PG', 'PG13', 'PG15', '15+', '18+', 'TBC']);
/** Ratings VOX classifies as suitable for family/kids recommendations. */
const FAMILY_SAFE_RATINGS = new Set(['G', 'PG', 'PG13']);

export function isFamilySafeRating(rating: string | undefined): boolean {
  return rating !== undefined && FAMILY_SAFE_RATINGS.has(rating.toUpperCase());
}

export function normalizeFormat(label: string): MovieFormat {
  const l = label.trim().toUpperCase();
  if (l.includes('IMAX')) return 'IMAX';
  if (l === 'MAX') return 'MAX';
  if (l.includes('4DX')) return '4DX';
  if (l.includes('GOLD')) return 'GOLD';
  if (l.includes('THEATRE')) return 'THEATRE';
  if (l.includes('KID')) return 'KIDS';
  if (l.includes('PREMIER')) return 'PREMIER';
  if (l.includes('PREMIUM')) return 'PREMIUM';
  if (l.includes('STANDARD') || l === 'STD' || l === '2D') return 'STANDARD';
  return 'OTHER';
}

/** Extract the Vista film id from an assets URL (P_HO00013065_...jpg). */
export function vistaFilmIdFromAsset(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = /\/(?:posters|heroes)\/[PB]_([A-Z0-9]+)_/.exec(url);
  return m?.[1];
}

/** Parse /movies/whatson and /movies/comingsoon listing pages. */
export function parseMovieListPage(
  html: string,
  status: Movie['status'],
): Movie[] {
  const movies: Movie[] = [];
  const articleRe = /<article\s+class="movie-summary"([\s\S]*?)<\/article>/g;
  let m: RegExpExecArray | null;
  while ((m = articleRe.exec(html))) {
    const block = m[1]!;
    try {
      const slug = /data-slug="([^"]+)"/.exec(block)?.[1];
      const title = /data-title="([^"]+)"/.exec(block)?.[1];
      if (!slug || !title) continue;
      const poster = /<img[^>]*class="poster"[^>]*src="([^"]+)"/.exec(block)?.[1];
      const ratingRaw = /class="classification[^"]*"\s*>([^<]+)</.exec(block)?.[1]?.trim();
      const language = /<strong>Language:<\/strong>\s*([^<]+)</.exec(block)?.[1]?.trim();
      const rating = ratingRaw && KNOWN_RATINGS.has(ratingRaw.toUpperCase())
        ? (ratingRaw.toUpperCase() as AgeRating)
        : ratingRaw;
      movies.push({
        id: slug,
        vistaFilmId: vistaFilmIdFromAsset(poster),
        title: decode(title),
        language: language ? decode(language) : undefined,
        genres: [],
        rating,
        posterUrl: poster,
        status,
        familySafe: isFamilySafeRating(ratingRaw),
      });
    } catch {
      // Skip malformed card; never fabricate.
    }
  }
  return movies;
}

interface JsonLdMovie {
  name?: string;
  genre?: string | string[];
  description?: string;
  inLanguage?: string;
  contentRating?: string;
  duration?: string;
  image?: string;
  actor?: { name?: string }[];
}

/** Metadata from a movie detail page (JSON-LD + rendered fields). */
export function parseMovieDetail(html: string, movieId: string): Movie | undefined {
  let ld: JsonLdMovie | undefined;
  const ldMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  if (ldMatch) {
    try {
      const parsed: unknown = JSON.parse(ldMatch[1]!);
      if (parsed && typeof parsed === 'object' && (parsed as { '@type'?: string })['@type'] === 'Movie') {
        ld = parsed as JsonLdMovie;
      }
    } catch {
      ld = undefined;
    }
  }
  const title =
    ld?.name ?? decode(/<h1>([^<]+)<\/h1>/.exec(html)?.[1] ?? '');
  if (!title) return undefined;

  const ratingRaw =
    ld?.contentRating ?? /class="classification[^"]*"\s*>([^<]+)</.exec(html)?.[1]?.trim();
  const durationMin = ld?.duration ? /PT(\d+)M/.exec(ld.duration)?.[1] : undefined;
  const subtitles = /Subtitles?:?<\/strong>\s*([^<]+)</i.exec(html)?.[1]?.trim();
  const poster = ld?.image ?? /<img[^>]*class="poster"[^>]*src="([^"]+)"/.exec(html)?.[1];
  const releaseDate = /Release Date:?<\/strong>\s*([^<]+)</i.exec(html)?.[1]?.trim();

  return {
    id: movieId,
    vistaFilmId: vistaFilmIdFromAsset(poster),
    title: decode(title),
    synopsis: ld?.description,
    language: ld?.inLanguage,
    subtitles,
    genres: ld?.genre ? (Array.isArray(ld.genre) ? ld.genre : [ld.genre]) : [],
    rating: ratingRaw?.toUpperCase(),
    runtimeMinutes: durationMin ? Number(durationMin) : undefined,
    posterUrl: poster,
    cast: ld?.actor?.map((a) => a.name).filter((n): n is string => !!n),
    releaseDate,
    status: 'now_showing',
    familySafe: isFamilySafeRating(ratingRaw),
  };
}

/** Available dates from the date-filter nav (?d=YYYYMMDD links + "Today"). */
export function parseAvailableDates(html: string, todayDate: string): string[] {
  const dates = new Set<string>();
  const nav = /<nav\s+class="date-filter"[\s\S]*?<\/nav>/.exec(html)?.[0];
  if (!nav) return [];
  if (/<span>Today<\/span>/.test(nav) || /<span>[^<]*<\/span>/.test(nav)) dates.add(todayDate);
  const re = /[?&]d(?:=|&#x3D;)(\d{8})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nav))) {
    const d = m[1]!;
    dates.add(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  }
  return [...dates].sort();
}

export interface ParsedShowtimeGroup {
  /** h3.highlight heading (cinema name on movie pages; cinema name on cinema pages too). */
  heading: string;
  showtimes: Omit<Showtime, 'movieId' | 'date' | 'cinemaId'>[];
}

/** Parse ol.showtimes blocks grouped under h3.highlight headings.
 *  Works for both movie pages (heading = cinema) and cinema pages. */
export function parseShowtimeGroups(sectionHtml: string): ParsedShowtimeGroup[] {
  const groups: ParsedShowtimeGroup[] = [];
  // Split by cinema headings; each heading is followed by one or more format blocks.
  const parts = sectionHtml.split(/<h3 class="highlight">/).slice(1);
  for (const part of parts) {
    const heading = decode(part.slice(0, part.indexOf('</h3>')));
    if (!heading) continue;
    const group: ParsedShowtimeGroup = { heading, showtimes: [] };
    // Format blocks: <strong>LABEL</strong> ... <li data-id="cccc-ssss"><a ...>time</a>
    const formatRe = /<strong>([^<]+)<\/strong>\s*<ol>([\s\S]*?)<\/ol>/g;
    let fm: RegExpExecArray | null;
    while ((fm = formatRe.exec(part))) {
      const formatLabel = decode(fm[1]!);
      const format = normalizeFormat(formatLabel);
      const sessRe = /<a class="action showtime" href="([^"]+)" data-id="(\d+)-(\d+)">([^<]+)</g;
      let sm: RegExpExecArray | null;
      while ((sm = sessRe.exec(fm[2]!))) {
        const timeLabel = decode(sm[4]!);
        const minutes = parseTimeLabel(timeLabel);
        if (minutes === undefined) continue;
        group.showtimes.push({
          id: `${sm[2]}-${sm[3]}`,
          vistaCinemaId: sm[2]!,
          vistaSessionId: sm[3]!,
          cinemaName: heading,
          timeLabel,
          // Post-midnight sessions listed under the same day sort after 24:00.
          minutesFromMidnight: minutes < 360 ? minutes + 1440 : minutes,
          format,
          formatLabel,
          bookingUrl: sm[1]!,
        });
      }
    }
    if (group.showtimes.length > 0) groups.push(group);
  }
  return groups;
}

/** Parse the showtimes section of a movie detail page. */
export function parseMoviePageShowtimes(
  html: string,
  movieId: string,
  date: string,
): Showtime[] {
  const idx = html.indexOf('id="showtimes"');
  if (idx < 0) return [];
  const section = html.slice(idx);
  const out: Showtime[] = [];
  for (const group of parseShowtimeGroups(section)) {
    for (const st of group.showtimes) {
      out.push({ ...st, movieId, date });
    }
  }
  return out.sort((a, b) => a.minutesFromMidnight - b.minutesFromMidnight);
}

export interface ParsedCinemaSummary {
  id: string;
  name: string;
  address?: string;
}

/** Parse the /cinemas directory page. */
export function parseCinemasPage(html: string): ParsedCinemaSummary[] {
  const cinemas: ParsedCinemaSummary[] = [];
  const re = /<article\s+class="cinema-summary"\s+data-slug="([^"]+)">([\s\S]*?)<\/article>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const slug = m[1]!;
    const block = m[2]!;
    const name = /<h3><a[^>]*>([^<]+)<\/a><\/h3>/.exec(block)?.[1];
    if (!name) continue;
    const address = /<strong>Address:<\/strong><br\s*\/?>([\s\S]*?)<\/p>/.exec(block)?.[1];
    cinemas.push({
      id: slug,
      name: decode(name),
      address: address ? decode(address.replace(/<[^>]+>/g, ' ')) : undefined,
    });
  }
  return cinemas;
}

export interface ParsedCinemaDayMovie {
  movieId: string;
  title: string;
  rating?: string;
  language?: string;
  runtimeMinutes?: number;
  heroUrl?: string;
  vistaFilmId?: string;
  showtimes: Omit<Showtime, 'date' | 'cinemaId'>[];
}

/** Parse /showtimes/{cinema-slug} (or ?c=&d= variant): article.movie-compare blocks. */
export function parseCinemaShowtimesPage(html: string): ParsedCinemaDayMovie[] {
  const out: ParsedCinemaDayMovie[] = [];
  const re = /<article\s+class="movie-compare"\s+data-slug="([^"]+)"[\s\S]*?(?=<article\s+class="movie-compare"|<\/main|<footer|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const block = m[0]!;
    const movieId = m[1]!;
    const title = /<h2>([^<]+)<\/h2>/.exec(block)?.[1];
    if (!title) continue;
    const hero = /<img[^>]*class="hero"[^>]*src="([^"]+)"/.exec(block)?.[1];
    const rating = /class="classification[^"]*"\s*>([^<]+)</.exec(block)?.[1]?.trim();
    const tags = [...block.matchAll(/<span class="tag">([^<]+)<\/span>/g)].map((t) => t[1]!.trim());
    const runtime = tags.find((t) => /^\d+\s*min$/i.test(t));
    const language = tags.find((t) => !/^\d+\s*min$/i.test(t));
    const groups = parseShowtimeGroups(block);
    const showtimes = groups.flatMap((g) => g.showtimes.map((st) => ({ ...st, movieId })));
    out.push({
      movieId,
      title: decode(title),
      rating: rating?.toUpperCase(),
      language,
      runtimeMinutes: runtime ? Number(/\d+/.exec(runtime)![0]) : undefined,
      heroUrl: hero,
      vistaFilmId: vistaFilmIdFromAsset(hero),
      showtimes,
    });
  }
  return out;
}
