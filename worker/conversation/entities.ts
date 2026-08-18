/** Entity extraction from natural-language messages.
 *
 * Movie and cinema mentions are resolved against the LIVE catalog (never a
 * hardcoded list) using fuzzy matching, so exact, partial and misspelled
 * titles all work. Dates/times use the Dubai-local phrase parser.
 */

import type { Cinema, Movie, MovieFormat } from '@shared/models';
import { fuzzyScore, normalize, parseDatePhrase, type DatePhraseResult } from '@shared/utils';

export interface ExtractedEntities {
  movie?: Movie;
  movieScore?: number;
  cinema?: Cinema;
  date?: DatePhraseResult;
  language?: string;
  genre?: string;
  format?: MovieFormat;
  familySafe?: boolean;
  /** e.g. "8 pm" / "8:30pm" showtime pick. */
  timePick?: number;
}

const LANGUAGES = [
  'english', 'hindi', 'malayalam', 'tamil', 'telugu', 'arabic', 'kannada',
  'urdu', 'punjabi', 'bengali', 'marathi', 'filipino', 'tagalog', 'japanese',
  'korean', 'french', 'spanish', 'turkish', 'russian', 'chinese', 'mandarin',
];

const GENRES = [
  'action', 'comedy', 'drama', 'horror', 'thriller', 'animation', 'romance',
  'adventure', 'crime', 'fantasy', 'mystery', 'documentary', 'biography',
  'musical', 'war', 'western', 'sport', 'sci-fi', 'science fiction',
];

const FORMAT_PATTERNS: [RegExp, MovieFormat][] = [
  [/\bimax\b/i, 'IMAX'],
  [/\b4dx\b/i, '4DX'],
  [/\bmax\b/i, 'MAX'],
  [/\bgold\b/i, 'GOLD'],
  [/\btheatre\b|\btheater\s+experience\b/i, 'THEATRE'],
  [/\bkids?\s+(screen|cinema|format)\b/i, 'KIDS'],
  [/\bpremier\b/i, 'PREMIER'],
  [/\bpremium\b/i, 'PREMIUM'],
  [/\bstandard\b|\bregular\b|\b2d\b/i, 'STANDARD'],
];

const FAMILY_PATTERNS =
  /\b(family|kids?|children|child[- ]?friendly|suitable for (kids|children|the family)|family[- ]?safe|for the family)\b/i;

/** Words that never start/belong to a movie-title mention. */
const STOPWORDS = new Set([
  'show', 'me', 'movies', 'movie', 'films', 'film', 'watch', 'want', 'to', 'i',
  'at', 'in', 'on', 'for', 'the', 'a', 'an', 'any', 'anything', 'what', 'whats',
  'available', 'tonight', 'today', 'tomorrow', 'weekend', 'this', 'after',
  'times', 'time', 'showtimes', 'please', 'can', 'you', 'we', 'see', 'book',
]);

/** Find the best movie mention in the message against the live catalog. */
export function findMovieMention(
  message: string,
  movies: Movie[],
): { movie: Movie; score: number } | undefined {
  const msg = normalize(message);
  if (!msg) return undefined;
  const msgTokens = msg.split(' ');
  let best: { movie: Movie; score: number } | undefined;

  for (const movie of movies) {
    const title = normalize(movie.title);
    const titleTokens = title.split(' ').filter((t) => t.length > 0);
    if (titleTokens.length === 0) continue;

    // Compound handling: "spiderman" should match "spider man". A message
    // token matching two adjacent title tokens joined covers both.
    const coveredByBigram = new Array<boolean>(titleTokens.length).fill(false);
    for (let i = 0; i < titleTokens.length - 1; i++) {
      const joined = titleTokens[i]! + titleTokens[i + 1]!;
      if (joined.length < 5) continue;
      for (const mt of msgTokens) {
        // The message token must actually be compound-length — otherwise a
        // short word ("the") inside the joined string would fake-cover both.
        if (mt.length < joined.length - 2) continue;
        if (mt === joined || fuzzyScore(mt, joined) >= 0.85) {
          coveredByBigram[i] = true;
          coveredByBigram[i + 1] = true;
        }
      }
    }

    // Per-title-token best match against the message (bigrams count).
    const bestPerToken = titleTokens.map((tt, i) => {
      let bestTok = coveredByBigram[i] ? 1 : 0;
      for (const mt of msgTokens) {
        if (bestTok >= 1) break;
        if (mt === tt) { bestTok = 1; break; }
        bestTok = Math.max(bestTok, fuzzyScore(mt, tt));
      }
      return bestTok;
    });
    const strong = bestPerToken.filter((s) => s >= 0.99).length;
    const covered = bestPerToken.reduce((acc, s) => (s >= 0.72 ? acc + s : acc), 0);
    const coverage = covered / titleTokens.length;

    // Partial-title support: users say "spiderman" for "Spider-Man: Brand
    // New Day" or "khalifa" for "Khalifa (Malayalam)". A fully-covered title
    // prefix is a strong signal even when overall coverage is low.
    const prefixLen = Math.min(2, titleTokens.length);
    const prefixCovered = bestPerToken.slice(0, prefixLen).every((s) => s >= 0.8);
    const firstToken = titleTokens[0]!;
    const GENERIC = new Set([...STOPWORDS, 'family', 'action', 'comedy', 'drama', 'horror', 'love', 'story', 'great', 'little', 'night']);
    const prefixScore = prefixCovered
      ? 0.82
      : bestPerToken[0]! >= 0.85 && firstToken.length >= 5 && !GENERIC.has(firstToken)
        ? 0.7
        : 0;
    // Distinctive-token guard: at least one non-stopword exact-ish hit
    // (bigram-compound coverage counts, e.g. "spiderman" → "spider man").
    const distinctiveHit = titleTokens.some(
      (tt, i) =>
        !STOPWORDS.has(tt) &&
        (coveredByBigram[i] || msgTokens.some((mt) => mt === tt || fuzzyScore(mt, tt) >= 0.8)),
    );
    if (!distinctiveHit) continue;
    // Single-token titles need a near-exact hit to avoid false positives.
    const threshold = titleTokens.length === 1 ? 0.85 : 0.6;
    const coverageScore = coverage * (0.85 + 0.15 * (strong / titleTokens.length));
    const score = Math.max(coverageScore, prefixScore);
    if (score >= threshold && (!best || score > best.score)) {
      best = { movie, score };
    }
  }
  return best;
}

/** Find a cinema mention (name fragment, alias like "MOE", slug words). */
export function findCinemaMention(message: string, cinemas: Cinema[]): Cinema | undefined {
  const msg = normalize(message);
  const ALIASES: Record<string, string> = {
    moe: 'mall-of-the-emirates',
    'mall of emirates': 'mall-of-the-emirates',
    'mall of the emirates': 'mall-of-the-emirates',
    mirdif: 'city-centre-mirdif',
    deira: 'city-centre-deira',
    ajman: 'city-centre-ajman',
    sharjah: 'city-centre-sharjah',
    fujairah: 'city-centre-fujairah',
    'festival city': 'dubai-festival-city-mall',
    'yas mall': 'yas-mall-abu-dhabi',
    'abu dhabi mall': 'abu-dhabi-mall-abu-dhabi',
    burjuman: 'burjuman',
    mercato: 'mercato',
    wafi: 'wafi-mall-at-wafi-city',
    'palm jumeirah': 'palm-jumeirah-mall',
    'al hamra': 'al-hamra-mall-ras-al-khaimah',
    'nation towers': 'nation-towers-abu-dhabi',
    galleria: 'the-galleria-al-maryah-island',
    'reem mall': 'reem-mall-abu-dhabi',
  };
  for (const [alias, slug] of Object.entries(ALIASES)) {
    if (msg.includes(alias)) {
      const hit = cinemas.find((c) => c.id === slug);
      if (hit) return hit;
    }
  }
  // Try n-gram fragments of cinema names within the message.
  let best: { cinema: Cinema; score: number } | undefined;
  for (const cinema of cinemas) {
    const name = normalize(cinema.name);
    const nameTokens = name.split(' ').filter((t) => t.length > 2);
    if (nameTokens.length === 0) continue;
    const msgTokens = msg.split(' ');
    let covered = 0;
    for (const nt of nameTokens) {
      if (msgTokens.some((mt) => mt === nt || fuzzyScore(mt, nt) >= 0.85)) covered++;
    }
    const score = covered / nameTokens.length;
    // Require most of a multi-word name, or the full distinctive word.
    if (score >= 0.66 && covered >= Math.min(2, nameTokens.length)) {
      if (!best || score > best.score) best = { cinema, score };
    }
  }
  return best?.cinema;
}

/** Explicit time pick like "the 8pm one", "8:30 pm show". */
export function findTimePick(message: string): number | undefined {
  const m = /\b(?:the\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(message);
  if (!m) return undefined;
  // Ignore if part of "after X pm" (that's a filter, not a pick).
  const before = message.slice(0, m.index).toLowerCase();
  if (/\bafter\s*$/.test(before)) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]!.toLowerCase() === 'pm' && h !== 12) h += 12;
  if (m[3]!.toLowerCase() === 'am' && h === 12) h = 0;
  const v = h * 60 + min;
  return v < 360 ? v + 1440 : v;
}

export function extractEntities(
  message: string,
  movies: Movie[],
  cinemas: Cinema[],
  now: Date = new Date(),
): ExtractedEntities {
  const out: ExtractedEntities = {};
  const msg = message.toLowerCase();

  const movieHit = findMovieMention(message, movies);
  if (movieHit) {
    out.movie = movieHit.movie;
    out.movieScore = movieHit.score;
  }
  out.cinema = findCinemaMention(message, cinemas);

  const dateResult = parseDatePhrase(message, now);
  if (dateResult.date || dateResult.timeFromMinutes !== undefined) out.date = dateResult;

  for (const lang of LANGUAGES) {
    if (new RegExp(`\\b${lang}\\b`).test(msg)) {
      out.language = lang.charAt(0).toUpperCase() + lang.slice(1);
      break;
    }
  }
  for (const genre of GENRES) {
    if (new RegExp(`\\b${genre.replace('-', '[- ]?')}\\b`).test(msg)) {
      out.genre = genre;
      break;
    }
  }
  for (const [re, fmt] of FORMAT_PATTERNS) {
    if (re.test(message)) {
      out.format = fmt;
      break;
    }
  }
  if (FAMILY_PATTERNS.test(message)) out.familySafe = true;
  out.timePick = findTimePick(message);
  return out;
}
