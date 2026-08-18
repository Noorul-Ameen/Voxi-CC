import { describe, expect, it } from 'vitest';
import type { Cinema, Movie } from '@shared/models';
import { extractEntities, findCinemaMention, findMovieMention } from '@worker/conversation/entities';

const NOW = new Date('2026-08-18T10:00:00Z'); // 14:00 Dubai, Tuesday

const movie = (id: string, title: string, rest: Partial<Movie> = {}): Movie => ({
  id,
  title,
  genres: [],
  status: 'now_showing',
  familySafe: false,
  ...rest,
});

const MOVIES: Movie[] = [
  movie('spider-man-brand-new-day', 'Spider-Man: Brand New Day'),
  movie('toy-story-5', 'Toy Story 5'),
  movie('the-odyssey', 'The Odyssey'),
  movie('khalifa-malayalam', 'Khalifa', { language: 'Malayalam' }),
  movie('lumivia-the-five-magical-wishes', 'Lumivia: The Five Magical Wishes'),
  movie('mahmoud-el-tany-arabic', 'Mahmoud El Tany', { language: 'Arabic' }),
  movie('the-end-of-oak-street', 'The End of Oak Street'),
  movie('mission-impossible-final', 'Mission: Impossible — The Final Reckoning'),
];

const cinema = (id: string, name: string): Cinema => ({ id, name, formats: [] });
const CINEMAS: Cinema[] = [
  cinema('mall-of-the-emirates', 'Mall of the Emirates'),
  cinema('city-centre-deira', 'City Centre Deira'),
  cinema('city-centre-mirdif', 'City Centre Mirdif'),
  cinema('al-jimi-mall', 'Al Jimi Mall'),
  cinema('nation-towers-abu-dhabi', 'Nation Towers - Abu Dhabi'),
  cinema('yas-mall-abu-dhabi', 'Yas Mall - Abu Dhabi'),
];

describe('findMovieMention', () => {
  it('matches exact titles', () => {
    expect(findMovieMention('I want to watch Toy Story 5', MOVIES)?.movie.id).toBe('toy-story-5');
  });
  it('matches partial titles', () => {
    expect(findMovieMention('show me spider-man', MOVIES)?.movie.id).toBe('spider-man-brand-new-day');
    expect(findMovieMention('mission impossible tonight', MOVIES)?.movie.id).toBe('mission-impossible-final');
  });
  it('matches run-together compounds', () => {
    expect(findMovieMention('i want to watch spiderman', MOVIES)?.movie.id).toBe('spider-man-brand-new-day');
  });
  it('matches misspellings', () => {
    expect(findMovieMention('show me tou story', MOVIES)?.movie.id).toBe('toy-story-5');
    expect(findMovieMention('the odyssee please', MOVIES)?.movie.id).toBe('the-odyssey');
  });
  it('matches single-word titles', () => {
    expect(findMovieMention('khalifa', MOVIES)?.movie.id).toBe('khalifa-malayalam');
  });
  it('does not hallucinate matches from filler words', () => {
    expect(findMovieMention('Any Malayalam movies tonight?', MOVIES)).toBeUndefined();
    expect(findMovieMention('Actually make it City Centre Deira', MOVIES)).toBeUndefined();
    expect(findMovieMention('Show family movies', MOVIES)).toBeUndefined();
    expect(findMovieMention('What times are available after 7 PM?', MOVIES)).toBeUndefined();
    expect(findMovieMention('Show IMAX movies tonight', MOVIES)).toBeUndefined();
  });
});

describe('findCinemaMention', () => {
  it('resolves aliases like MOE', () => {
    expect(findCinemaMention('show this at MOE tomorrow', CINEMAS)?.id).toBe('mall-of-the-emirates');
  });
  it('resolves full names', () => {
    expect(findCinemaMention('at Mall of the Emirates', CINEMAS)?.id).toBe('mall-of-the-emirates');
    expect(findCinemaMention('City Centre Deira please', CINEMAS)?.id).toBe('city-centre-deira');
  });
  it('does not match cinemas from unrelated words', () => {
    expect(findCinemaMention('I want to watch spiderman', CINEMAS)).toBeUndefined();
    expect(findCinemaMention('anything after 7 pm', CINEMAS)).toBeUndefined();
  });
});

describe('extractEntities', () => {
  it('extracts combined movie + cinema + date', () => {
    const e = extractEntities('Show Spider-Man at Mall of the Emirates tomorrow', MOVIES, CINEMAS, NOW);
    expect(e.movie?.id).toBe('spider-man-brand-new-day');
    expect(e.cinema?.id).toBe('mall-of-the-emirates');
    expect(e.date?.date).toBe('2026-08-19');
  });
  it('extracts language + time floor', () => {
    const e = extractEntities('Any Malayalam movies tonight?', MOVIES, CINEMAS, NOW);
    expect(e.movie).toBeUndefined();
    expect(e.language).toBe('Malayalam');
    expect(e.date?.date).toBe('2026-08-18');
    expect(e.date?.timeFromMinutes).toBe(18 * 60);
  });
  it('extracts format and family-safe', () => {
    expect(extractEntities('Show IMAX movies tonight', MOVIES, CINEMAS, NOW).format).toBe('IMAX');
    expect(extractEntities('anything suitable for kids?', MOVIES, CINEMAS, NOW).familySafe).toBe(true);
  });
  it('extracts an explicit showtime pick, not confusing it with "after" filters', () => {
    expect(extractEntities('book the 8pm show', MOVIES, CINEMAS, NOW).timePick).toBe(20 * 60);
    expect(extractEntities('times after 7 pm', MOVIES, CINEMAS, NOW).timePick).toBeUndefined();
  });
  it('extracts genre', () => {
    expect(extractEntities('show me action movies tomorrow', MOVIES, CINEMAS, NOW).genre).toBe('action');
  });
});
