/** Conversation engine integration tests over genuine VOX fixture data. */
import { describe, expect, it } from 'vitest';
import type { ConversationState } from '@shared/models';
import { createInitialState, runConversationTurn } from '@worker/conversation/engine';
import { createFixtureServices, FIXTURE_NOW, FIXTURE_TOMORROW } from '../helpers/fixtureServices';

async function turn(message: string, state?: ConversationState, services = createFixtureServices()) {
  return runConversationTurn({
    message,
    state: state ?? createInitialState(),
    services,
    now: FIXTURE_NOW,
  });
}

describe('movie → cinema → date → showtime journey', () => {
  it('walks the full journey with genuine session ids', async () => {
    const services = createFixtureServices();

    const t1 = await turn('I want to watch spiderman', undefined, services);
    let s = t1.updatedConversationState;
    expect(t1.detectedIntent).toBe('select_movie');
    expect(s.selectedMovie?.id).toBe('spider-man-brand-new-day');
    expect(t1.showtimes!.length).toBeGreaterThan(10);
    expect(s.currentJourneyStage).toBe('movie_selected');

    const t2 = await turn('Show it at Mall of the Emirates tomorrow', s, services);
    s = t2.updatedConversationState;
    expect(s.selectedCinema?.id).toBe('mall-of-the-emirates');
    expect(s.selectedDate).toBe(FIXTURE_TOMORROW);
    expect(s.selectedMovie?.id).toBe('spider-man-brand-new-day'); // preserved
    expect(t2.showtimes!.length).toBeGreaterThan(0);
    for (const st of t2.showtimes!) {
      expect(st.cinemaName).toMatch(/Mall of the Emirates/i);
      expect(st.id).toMatch(/^0002-\d+$/); // genuine MOE Vista sessions
    }

    const pick = t2.showtimes![0]!;
    const t3 = await turn(`Book the ${pick.timeLabel} show`, s, services);
    s = t3.updatedConversationState;
    expect(s.selectedShowtime?.id).toBe(pick.id);
    expect(s.currentJourneyStage).toBe('showtime_selected');
    expect(t3.assistantMessage).toContain(pick.timeLabel);
  });

  it('changing cinema preserves movie+date and clears showtime/tickets/seats', async () => {
    const services = createFixtureServices();
    const t1 = await turn('spider-man at mall of the emirates tomorrow', undefined, services);
    let s = t1.updatedConversationState;
    const pick = t1.showtimes![0]!;
    const t2 = await turn(`Book the ${pick.timeLabel} show`, s, services);
    s = t2.updatedConversationState;
    expect(s.selectedShowtime).toBeDefined();

    const t3 = await turn('Actually show me City Centre Deira instead', s, services);
    s = t3.updatedConversationState;
    expect(s.selectedCinema?.id).toBe('city-centre-deira');
    expect(s.selectedMovie?.id).toBe('spider-man-brand-new-day'); // preserved
    expect(s.selectedDate).toBe(FIXTURE_TOMORROW); // preserved
    expect(s.selectedShowtime).toBeUndefined(); // dependent state cleared
    expect(s.selectedTickets).toEqual([]);
    expect(s.selectedSeats).toEqual([]);
  });

  it('changing date clears the showtime but keeps movie and cinema', async () => {
    const services = createFixtureServices();
    const t1 = await turn('spiderman today', undefined, services);
    let s = t1.updatedConversationState;
    const pick = t1.showtimes!.find((st) => st.cinemaName === 'Mall of the Emirates')!;
    s = (await turn(`Book the ${pick.timeLabel} show at ${pick.cinemaName}`, s, services)).updatedConversationState;
    expect(s.selectedShowtime).toBeDefined();

    const t3 = await turn('show me tomorrow instead', s, services);
    s = t3.updatedConversationState;
    expect(s.selectedDate).toBe(FIXTURE_TOMORROW);
    expect(s.selectedMovie?.id).toBe('spider-man-brand-new-day');
    expect(s.selectedShowtime).toBeUndefined();
  });

  it('changing the movie clears the showtime but keeps cinema and date', async () => {
    const services = createFixtureServices();
    let s = (await turn('spiderman at MOE tomorrow', undefined, services)).updatedConversationState;
    const t = await turn('actually I want to watch toy story instead', s, services);
    s = t.updatedConversationState;
    expect(s.selectedMovie?.id).toBe('toy-story-5');
    expect(s.selectedCinema?.id).toBe('mall-of-the-emirates');
    expect(s.selectedDate).toBe(FIXTURE_TOMORROW);
    expect(s.selectedShowtime).toBeUndefined();
  });

  it('reset restarts the journey but keeps the conversation id', async () => {
    const services = createFixtureServices();
    let s = (await turn('spiderman at MOE tomorrow', undefined, services)).updatedConversationState;
    const id = s.conversationId;
    const t = await turn('start over', s, services);
    s = t.updatedConversationState;
    expect(s.conversationId).toBe(id);
    expect(s.selectedMovie).toBeUndefined();
    expect(s.selectedCinema).toBeUndefined();
    expect(s.currentJourneyStage).toBe('discovery');
  });
});

describe('discovery & filters', () => {
  it('family-safe filtering excludes non-family ratings (genuine classification only)', async () => {
    const t = await turn('Show family movies');
    expect(t.detectedIntent).toBe('filter_movies');
    const movies = t.moviesWithShowtimes!;
    expect(movies.length).toBeGreaterThan(0);
    for (const m of movies) {
      expect(['G', 'PG', 'PG13']).toContain(m.rating);
      expect(m.familySafe).toBe(true);
    }
  });

  it('language filter finds Malayalam movies', async () => {
    const t = await turn('Any Malayalam movies?');
    const movies = t.moviesWithShowtimes!;
    expect(movies.length).toBeGreaterThan(0);
    expect(movies.every((m) => m.language === 'Malayalam')).toBe(true);
  });

  it('misspelled search still finds the movie', async () => {
    const t = await turn('show me tou story');
    expect(t.updatedConversationState.selectedMovie?.id).toBe('toy-story-5');
  });

  it('"after 7 PM" produces a time floor and filters sessions', async () => {
    const services = createFixtureServices();
    const s = (await turn('spiderman', undefined, services)).updatedConversationState;
    const t = await turn('What times are available after 7 PM?', s, services);
    expect(t.updatedConversationState.activeFilters.timeFromMinutes).toBe(19 * 60);
    for (const st of t.showtimes!) {
      expect(st.minutesFromMidnight).toBeGreaterThanOrEqual(19 * 60);
    }
  });

  it('empty result is explicit, not an error and not fabricated', async () => {
    const t = await turn('Show me Kannada movies');
    expect(t.moviesWithShowtimes).toEqual([]);
    expect(t.assistantMessage).toMatch(/no movies|genuinely/i);
    expect(t.structuredError).toBeUndefined();
  });
});

describe('upstream failure handling', () => {
  it('reports failure without fabricating data and preserves selections', async () => {
    const okServices = createFixtureServices();
    const s = (await turn('spiderman at MOE tomorrow', undefined, okServices)).updatedConversationState;

    const brokenServices = createFixtureServices({ failAll: true });
    const t = await turn('show me the showtimes', s, brokenServices);
    expect(t.structuredError?.code).toMatch(/UPSTREAM/);
    expect(t.assistantMessage).toMatch(/couldn't retrieve|try again/i);
    expect(t.updatedConversationState.selectedMovie?.id).toBe('spider-man-brand-new-day');
    expect(t.movies).toBeUndefined();
    expect(t.showtimes).toBeUndefined();
  });

  it('timeouts surface as retryable errors', async () => {
    const t = await turn('what movies are on?', undefined, createFixtureServices({ timeoutAll: true }));
    expect(t.structuredError?.code).toBe('UPSTREAM_TIMEOUT');
    expect(t.structuredError?.retryable).toBe(true);
  });

  it('malformed upstream responses are rejected, never parsed into fake data', async () => {
    const t = await turn('what movies are on?', undefined, createFixtureServices({ malformedAll: true }));
    expect(t.structuredError?.code).toMatch(/UPSTREAM/);
    expect(t.moviesWithShowtimes ?? []).toEqual([]);
  });
});

describe('protected commerce stays fail-closed in conversation', () => {
  it('never claims payment/booking success', async () => {
    const services = createFixtureServices();
    let s = (await turn('spiderman at MOE tomorrow', undefined, services)).updatedConversationState;
    const pick = 'Book the ' + (await turn('spiderman at MOE tomorrow', undefined, services)).showtimes![0]!.timeLabel + ' show';
    s = (await turn(pick, s, services)).updatedConversationState;
    expect(s.selectedShowtime).toBeDefined();

    for (const msg of ['Pay for it now', 'Confirm my booking', 'Order popcorn', 'Choose seats for me']) {
      const t = await turn(msg, s, services);
      expect(t.structuredError?.code).toBe('CAPABILITY_UNAVAILABLE');
      expect(t.assistantMessage).not.toMatch(/payment successful|booking confirmed|seats reserved|order placed/i);
      expect(t.assistantMessage).toMatch(/official VOX|isn't connected|never simulate/i);
    }
  });

  it('refund/cancellation/history requests are honestly declined', async () => {
    for (const msg of ['Cancel my booking', 'I want a refund', 'Show my booking history']) {
      const t = await turn(msg);
      expect(t.structuredError?.code).toBe('CAPABILITY_UNAVAILABLE');
      expect(t.assistantMessage).not.toMatch(/refund successful|cancellation successful|here are your bookings/i);
    }
  });
});

describe('multi-turn context preservation', () => {
  it('keeps accumulated filters across turns', async () => {
    const services = createFixtureServices();
    const s = (await turn('Show Malayalam movies', undefined, services)).updatedConversationState;
    expect(s.activeFilters.language).toBe('Malayalam');
    const t2 = await turn('only family friendly ones please', s, services);
    expect(t2.updatedConversationState.activeFilters.language).toBe('Malayalam');
    expect(t2.updatedConversationState.activeFilters.familySafe).toBe(true);
  });
});
