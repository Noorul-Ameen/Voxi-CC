/** Deterministic conversation engine.
 *
 * Natural-language interpretation (entities, dates, fuzzy titles) feeds a
 * deterministic state machine over ConversationState — the single source of
 * truth shared by chat, voice, movie cards and selectors. Changing an
 * earlier selection preserves still-valid downstream context and clears
 * dependent state (showtime → tickets → seats → food) instead of
 * restarting the conversation.
 */

import type {
  Cinema,
  ConversationIntent,
  ConversationResponse,
  ConversationState,
  FilterState,
  JourneyStage,
  Movie,
  MovieWithShowtimes,
  Showtime,
  SuggestedAction,
} from '@shared/models';
import { UAE_TIMEZONE, formatDateLabel, formatMinutes, nowInDubai, uid } from '@shared/utils';
import type { AppServices } from '../providers/registry';
import { UpstreamError } from '../providers/vox/client';
import { extractEntities, type ExtractedEntities } from './entities';

export function createInitialState(conversationId?: string): ConversationState {
  return {
    conversationId: conversationId ?? uid('conv'),
    selectedTickets: [],
    selectedSeats: [],
    foodSelection: [],
    activeFilters: {},
    locale: 'en-AE',
    timezone: UAE_TIMEZONE,
    currentJourneyStage: 'discovery',
  };
}

/** Merge a partial client-supplied state into a well-formed state. */
export function normalizeState(partial?: Partial<ConversationState>): ConversationState {
  const base = createInitialState(partial?.conversationId);
  return {
    ...base,
    ...partial,
    conversationId: partial?.conversationId ?? base.conversationId,
    selectedTickets: partial?.selectedTickets ?? [],
    selectedSeats: partial?.selectedSeats ?? [],
    foodSelection: partial?.foodSelection ?? [],
    activeFilters: partial?.activeFilters ?? {},
    timezone: UAE_TIMEZONE,
    locale: partial?.locale ?? 'en-AE',
    currentJourneyStage: partial?.currentJourneyStage ?? 'discovery',
  };
}

export function computeStage(state: ConversationState): JourneyStage {
  if (state.selectedShowtime) return 'showtime_selected';
  if (state.selectedMovie && state.selectedCinema && state.selectedDate) return 'date_selected';
  if (state.selectedMovie && state.selectedCinema) return 'cinema_selected';
  if (state.selectedMovie) return 'movie_selected';
  return 'discovery';
}

/** Clear all state that depends on the showtime. */
function clearShowtimeDependents(state: ConversationState): void {
  state.selectedShowtime = undefined;
  state.selectedTickets = [];
  state.selectedSeats = [];
  state.foodSelection = [];
}

/* ── Intent detection ────────────────────────────────────────────────── */

const COMMERCE_INTENTS: [RegExp, ConversationIntent][] = [
  [/\b(refund)\b/i, 'request_refund'],
  [/\b(cancel)\b/i, 'request_cancellation'],
  [/\b(booking history|my bookings|past bookings|previous bookings)\b/i, 'request_booking_history'],
  [/\b(pay|payment|checkout|check out)\b/i, 'request_payment'],
  [/\b(book|booking|reserve|buy)\b.*\b(ticket|seat|this|it|show)?\b/i, 'request_booking'],
  [/\b(food|popcorn|snack|drink|nachos|combo|f&b)\b/i, 'request_food'],
  [/\b(seat|seats|seating|seat map)\b/i, 'request_seat'],
  [/\b(tickets?|ticket types?|prices?|how much)\b/i, 'request_ticket'],
];

export function detectIntent(
  message: string,
  entities: ExtractedEntities,
  state: ConversationState,
): ConversationIntent {
  const msg = message.toLowerCase().trim();

  if (/^(hi|hello|hey|salam|salaam|marhaba|good (morning|afternoon|evening))\b/.test(msg))
    return 'greeting';
  if (/\b(help|what can you do|how does this work)\b/.test(msg)) return 'help';
  if (/\b(start over|reset|restart|clear everything|new search)\b/.test(msg))
    return 'reset_conversation';

  for (const [re, intent] of COMMERCE_INTENTS) {
    if (re.test(msg)) {
      // "book"-like words with a movie/cinema/time mention and no existing
      // showtime are discovery ("I want to book Mission Impossible") — treat
      // as selection first.
      if (
        intent === 'request_booking' &&
        !state.selectedShowtime &&
        (entities.movie || entities.cinema || entities.timePick !== undefined)
      ) {
        break;
      }
      return intent;
    }
  }

  if (
    /\b(what time|show ?times?|timings?|times available)\b/.test(msg) &&
    (state.selectedMovie || entities.movie)
  ) {
    return entities.timePick !== undefined ? 'select_showtime' : 'change_showtime';
  }
  if (entities.timePick !== undefined && state.selectedMovie) return 'select_showtime';

  if (entities.movie && entities.movieScore! >= 0.6) {
    return state.selectedMovie && state.selectedMovie.id !== entities.movie.id
      ? 'select_movie'
      : 'select_movie';
  }

  if (entities.cinema) {
    return state.selectedCinema && state.selectedCinema.id !== entities.cinema.id
      ? 'change_cinema'
      : 'select_cinema';
  }

  if (entities.date?.date) {
    return state.selectedDate && state.selectedDate !== entities.date.date
      ? 'change_date'
      : 'select_date';
  }

  if (entities.language || entities.genre || entities.format || entities.familySafe || entities.date?.timeFromMinutes !== undefined) {
    return 'filter_movies';
  }

  if (/\b(about|synopsis|plot|cast|rating|how long|runtime|duration)\b/.test(msg) && (state.selectedMovie || entities.movie)) {
    return 'ask_movie_question';
  }
  if (/\b(where|address|location|directions|parking)\b/.test(msg) && (state.selectedCinema || entities.cinema)) {
    return 'ask_cinema_question';
  }
  if (/\b(movies?|films?|watch|showing|on tonight|whats on|what's on)\b/.test(msg)) {
    return 'discover_movie';
  }
  return 'unknown';
}

/* ── Engine ──────────────────────────────────────────────────────────── */

export interface EngineInput {
  message: string;
  state: ConversationState;
  services: AppServices;
  now?: Date;
}

export async function runConversationTurn(input: EngineInput): Promise<ConversationResponse> {
  const { message, services } = input;
  const now = input.now ?? new Date();
  const state: ConversationState = structuredClone(input.state);

  // Live catalogs for entity resolution. Failures degrade gracefully.
  let catalog: Movie[] = [];
  let cinemas: Cinema[] = [];
  let catalogError: UpstreamError | undefined;
  try {
    [catalog, cinemas] = await Promise.all([
      services.vox.listMovies('now_showing'),
      services.vox.listCinemas(),
    ]);
  } catch (err) {
    if (err instanceof UpstreamError) catalogError = err;
  }

  const entities = extractEntities(message, catalog, cinemas, now);
  const intent = detectIntent(message, entities, state);

  /* Apply state transitions. */
  applyTransition(state, intent, entities);
  state.currentJourneyStage = computeStage(state);

  /* Compose the data + reply for this state. */
  try {
    const response = await composeResponse({
      intent,
      entities,
      state,
      services,
      message,
      now,
      catalogAvailable: !catalogError,
    });
    return response;
  } catch (err) {
    if (err instanceof UpstreamError) {
      return {
        assistantMessage:
          "I couldn't retrieve the latest information from VOX Cinemas right now. " +
          'Your selections are preserved — please try again in a moment.',
        detectedIntent: intent,
        updatedConversationState: state,
        suggestedActions: [{ label: 'Retry', message }],
        structuredError: err.apiError,
      };
    }
    throw err;
  }
}

function applyTransition(
  state: ConversationState,
  intent: ConversationIntent,
  entities: ExtractedEntities,
): void {
  switch (intent) {
    case 'reset_conversation': {
      const id = state.conversationId;
      Object.assign(state, createInitialState(id));
      return;
    }
    case 'select_movie': {
      if (entities.movie && state.selectedMovie?.id !== entities.movie.id) {
        state.selectedMovie = entities.movie;
        clearShowtimeDependents(state); // cinema/date preserved if still valid
      }
      break;
    }
    case 'select_cinema':
    case 'change_cinema': {
      if (entities.cinema && state.selectedCinema?.id !== entities.cinema.id) {
        state.selectedCinema = entities.cinema;
        clearShowtimeDependents(state); // movie + date preserved
      }
      break;
    }
    case 'select_date':
    case 'change_date': {
      if (entities.date?.date && state.selectedDate !== entities.date.date) {
        state.selectedDate = entities.date.date;
        clearShowtimeDependents(state); // movie + cinema preserved
      }
      break;
    }
    default:
      break;
  }

  /* Secondary entities piggyback on any intent ("Show MI at MOE tomorrow"). */
  if (entities.movie && intent !== 'ask_movie_question' && state.selectedMovie?.id !== entities.movie.id) {
    state.selectedMovie = entities.movie;
    clearShowtimeDependents(state);
  }
  if (entities.cinema && state.selectedCinema?.id !== entities.cinema.id) {
    state.selectedCinema = entities.cinema;
    clearShowtimeDependents(state);
  }
  if (entities.date?.date && state.selectedDate !== entities.date.date) {
    state.selectedDate = entities.date.date;
    clearShowtimeDependents(state);
  }

  /* Filters accumulate; explicit new values overwrite. */
  const f: FilterState = { ...state.activeFilters };
  if (entities.language) f.language = entities.language;
  if (entities.genre) f.genre = entities.genre;
  if (entities.format) f.format = entities.format;
  if (entities.familySafe) f.familySafe = true;
  if (entities.date?.timeFromMinutes !== undefined) f.timeFromMinutes = entities.date.timeFromMinutes;
  if (state.selectedCinema) f.cinemaId = state.selectedCinema.id;
  if (state.selectedDate) f.date = state.selectedDate;
  state.activeFilters = f;
}

interface ComposeInput {
  intent: ConversationIntent;
  entities: ExtractedEntities;
  state: ConversationState;
  services: AppServices;
  message: string;
  now: Date;
  catalogAvailable: boolean;
}

async function composeResponse(input: ComposeInput): Promise<ConversationResponse> {
  const { intent, entities, state, services, now } = input;
  const base = {
    detectedIntent: intent,
    updatedConversationState: state,
  };

  /* Commerce intents: fail-closed provider results, honest messaging. */
  const commerceHandler = await handleCommerceIntents(intent, state, services);
  if (commerceHandler) return { ...base, ...commerceHandler, updatedConversationState: state };

  switch (intent) {
    case 'greeting':
    case 'help': {
      return {
        ...base,
        assistantMessage:
          intent === 'greeting'
            ? "Hi! I'm your VOX Cinemas assistant for the UAE. I can help you find movies, cinemas and showtimes — try \"Show family movies tonight\" or \"Any IMAX movies at Mall of the Emirates tomorrow?\""
            : 'I can help you discover movies now showing at VOX Cinemas UAE, filter by cinema, date, language, genre or format, and find showtimes. Once you pick a showtime I can hand you to VOX to complete the booking. Try: "Malayalam films this weekend" or "What times are available after 7 PM?"',
        suggestedActions: [
          { label: "What's on tonight", message: "What's on tonight?" },
          { label: 'Family movies', message: 'Show family movies' },
          { label: 'IMAX near me', message: 'Show IMAX movies' },
        ],
      };
    }
    case 'reset_conversation': {
      const movies = await discoverSafely(services, {}, now);
      return {
        ...base,
        assistantMessage: "Fresh start! Here's what's showing at VOX Cinemas right now.",
        moviesWithShowtimes: movies ?? undefined,
        suggestedActions: defaultSuggestions(state),
      };
    }
    case 'ask_movie_question': {
      const movie = entities.movie ?? state.selectedMovie;
      if (!movie) break;
      const detail = (await services.vox.getMovie(movie.id).catch(() => undefined)) ?? movie;
      const parts: string[] = [];
      if (detail.synopsis) parts.push(detail.synopsis);
      const facts: string[] = [];
      if (detail.rating) facts.push(`Rated ${detail.rating}`);
      if (detail.runtimeMinutes) facts.push(`${detail.runtimeMinutes} min`);
      if (detail.language) facts.push(detail.language);
      if (detail.genres.length) facts.push(detail.genres.join(', '));
      if (detail.cast?.length) facts.push(`Starring ${detail.cast.slice(0, 4).join(', ')}`);
      if (facts.length) parts.push(facts.join(' · '));
      return {
        ...base,
        assistantMessage: parts.join('\n\n') || `Here's what I know about ${detail.title}.`,
        movies: [detail],
        suggestedActions: [
          { label: `Showtimes for ${detail.title}`, message: `Show showtimes for ${detail.title}` },
          { label: 'Pick a cinema', message: 'Which cinemas show it?' },
        ],
      };
    }
    case 'ask_cinema_question': {
      const cinema = entities.cinema ?? state.selectedCinema;
      if (!cinema) break;
      return {
        ...base,
        assistantMessage: `${cinema.name}${cinema.address ? ` — ${cinema.address}` : ''}. Want to see what's showing there?`,
        cinemas: [cinema],
        suggestedActions: [
          { label: `Movies at ${cinema.name}`, message: `What's showing at ${cinema.name}?` },
        ],
      };
    }
    default:
      break;
  }

  /* Discovery / selection intents share one data path. */
  return discoveryResponse(input);
}

async function handleCommerceIntents(
  intent: ConversationIntent,
  state: ConversationState,
  services: AppServices,
): Promise<Pick<ConversationResponse, 'assistantMessage' | 'suggestedActions' | 'structuredError'> | undefined> {
  const need = (thing: string): string =>
    `Before ${thing}, let's pick a movie, cinema and showtime. What would you like to watch?`;

  switch (intent) {
    case 'request_ticket': {
      if (!state.selectedShowtime) return { assistantMessage: need('choosing tickets'), suggestedActions: defaultSuggestions(state) };
      const st = state.selectedShowtime;
      const result = await services.providers.tickets.getTicketTypes(st.vistaCinemaId, st.vistaSessionId);
      if (result.status === 'unavailable') {
        return {
          assistantMessage:
            `Live ticket types and prices need the official VOX booking API, which isn't connected yet. ` +
            `You can complete this booking on VOX directly — your session ${st.id} (${st.timeLabel}, ${st.formatLabel}) is a genuine VOX showtime: ${st.bookingUrl}`,
          suggestedActions: [
            { label: 'Open VOX booking', message: `Open the VOX booking page for ${st.timeLabel}` },
            { label: 'Change showtime', message: 'Show other times' },
          ],
          structuredError: { code: 'CAPABILITY_UNAVAILABLE', message: result.reason, retryable: false, provider: 'vox-commerce' },
        };
      }
      return undefined;
    }
    case 'request_seat':
    case 'request_food':
    case 'request_payment':
    case 'request_booking': {
      if (!state.selectedShowtime) {
        return { assistantMessage: need('booking'), suggestedActions: defaultSuggestions(state) };
      }
      const st = state.selectedShowtime;
      const capability =
        intent === 'request_seat' ? 'Seat selection' :
        intent === 'request_food' ? 'Food & beverage ordering' :
        intent === 'request_payment' ? 'Payment' : 'Booking';
      return {
        assistantMessage:
          `${capability} through this assistant requires the official VOX booking API, which isn't connected in this environment — I never simulate a real booking. ` +
          `Your selected showtime is genuine: ${st.timeLabel} (${st.formatLabel}) at ${st.cinemaName} on ${formatDateLabel(st.date)}. ` +
          `Complete it securely on VOX here: ${st.bookingUrl}`,
        suggestedActions: [
          { label: 'Change showtime', message: 'Show other times' },
          { label: 'Change cinema', message: 'Show other cinemas' },
        ],
        structuredError: {
          code: 'CAPABILITY_UNAVAILABLE',
          message: `${capability} requires the official VOX partner API.`,
          retryable: false,
          provider: 'vox-commerce',
        },
      };
    }
    case 'request_booking_history':
    case 'request_cancellation':
    case 'request_refund': {
      const capability =
        intent === 'request_booking_history' ? 'Booking history' :
        intent === 'request_cancellation' ? 'Cancellation' : 'Refunds';
      return {
        assistantMessage:
          `${capability} require${capability.endsWith('s') ? '' : 's'} a VOX customer account connection, which isn't available here. ` +
          'Please use the VOX Cinemas website or app for existing bookings — I can still help you find movies and showtimes.',
        suggestedActions: defaultSuggestions(state),
        structuredError: {
          code: 'CAPABILITY_UNAVAILABLE',
          message: `${capability} requires the official VOX customer API.`,
          retryable: false,
          provider: 'vox-commerce',
        },
      };
    }
    default:
      return undefined;
  }
}

async function discoverSafely(
  services: AppServices,
  filters: FilterState,
  _now: Date,
): Promise<MovieWithShowtimes[] | null> {
  try {
    return await services.vox.discover(filters);
  } catch {
    return null;
  }
}

async function discoveryResponse(input: ComposeInput): Promise<ConversationResponse> {
  const { state, services, entities, intent, now } = input;
  const base = { detectedIntent: intent, updatedConversationState: state };
  const today = nowInDubai(now).date;

  /* Showtime pick: resolve the requested time against genuine sessions. */
  if (
    (intent === 'select_showtime' || entities.timePick !== undefined) &&
    state.selectedMovie
  ) {
    const date = state.selectedDate ?? today;
    state.selectedDate = date;
    const all = await services.vox.getShowtimesForMovie(state.selectedMovie.id, date);
    let candidates = all;
    if (state.selectedCinema) {
      candidates = candidates.filter(
        (st) => st.cinemaId === state.selectedCinema!.id || similarName(st.cinemaName, state.selectedCinema!.name),
      );
    }
    if (state.activeFilters.format) {
      candidates = candidates.filter((st) => st.format === state.activeFilters.format);
    }
    if (entities.timePick !== undefined) {
      const pick = entities.timePick;
      const exact = candidates.filter((st) => Math.abs(st.minutesFromMidnight - pick) <= 15);
      if (exact.length > 0) {
        const chosen = exact[0]!;
        state.selectedShowtime = chosen;
        state.selectedFormat = chosen.format;
        state.currentJourneyStage = computeStage(state);
        return {
          ...base,
          updatedConversationState: state,
          assistantMessage:
            `Locked in: ${state.selectedMovie.title} at ${chosen.cinemaName}, ${formatDateLabel(date, now)} at ${chosen.timeLabel} (${chosen.formatLabel}). ` +
            `To buy tickets, continue on VOX's secure booking page — this is a genuine session.`,
          showtimes: [chosen],
          suggestedActions: [
            { label: 'Tickets & prices', message: 'What are the ticket prices?' },
            { label: 'Change time', message: 'Show other times' },
            { label: 'Change date', message: 'Show tomorrow instead' },
          ],
        };
      }
      if (candidates.length > 0) {
        return {
          ...base,
          assistantMessage: `I couldn't find a session at ${formatMinutes(entities.timePick)} ${state.selectedCinema ? `at ${state.selectedCinema.name} ` : ''}on ${formatDateLabel(date, now)}. Here are the genuine times available:`,
          showtimes: candidates,
          suggestedActions: candidates.slice(0, 3).map((st) => ({
            label: `${st.timeLabel} ${st.formatLabel}`,
            message: `Book the ${st.timeLabel} show`,
          })),
        };
      }
    } else if (candidates.length > 0) {
      return {
        ...base,
        assistantMessage: `Here are the showtimes for ${state.selectedMovie.title}${state.selectedCinema ? ` at ${state.selectedCinema.name}` : ''} on ${formatDateLabel(date, now)}:`,
        showtimes: candidates,
        suggestedActions: candidates.slice(0, 3).map((st) => ({
          label: `${st.timeLabel} ${st.formatLabel}`,
          message: `Book the ${st.timeLabel} show`,
        })),
      };
    }
    // Fall through to general discovery messaging when nothing matched.
  }

  /* General discovery with current filters/selections. */
  const filters: FilterState = { ...state.activeFilters };
  if (state.selectedCinema) filters.cinemaId = state.selectedCinema.id;
  if (state.selectedDate) filters.date = state.selectedDate;
  if (state.selectedMovie && intent !== 'discover_movie' && intent !== 'filter_movies') {
    filters.query = undefined;
    /* Movie-centred view: fetch its showtimes for the (possibly new) context. */
    const date = state.selectedDate ?? today;
    const showtimes = await services.vox.getShowtimesForMovie(state.selectedMovie.id, date);
    const inCinema = state.selectedCinema
      ? showtimes.filter(
          (st) => st.cinemaId === state.selectedCinema!.id || similarName(st.cinemaName, state.selectedCinema!.name),
        )
      : showtimes;
    const timeFiltered = filters.timeFromMinutes !== undefined
      ? inCinema.filter((st) => st.minutesFromMidnight >= filters.timeFromMinutes!)
      : inCinema;
    const formatFiltered = filters.format
      ? timeFiltered.filter((st) => st.format === filters.format)
      : timeFiltered;
    const availableDates = await services.vox.getAvailableDates(state.selectedMovie.id).catch(() => []);

    if (formatFiltered.length === 0) {
      const scope = [
        state.selectedCinema ? `at ${state.selectedCinema.name}` : '',
        `on ${formatDateLabel(date, now)}`,
        filters.format ? `in ${filters.format}` : '',
        filters.timeFromMinutes !== undefined ? `after ${formatMinutes(filters.timeFromMinutes)}` : '',
      ].filter(Boolean).join(' ');
      const fallbackHint = inCinema.length > 0
        ? ` There are ${inCinema.length} other session(s) that day if you can flex the time or format.`
        : state.selectedCinema
          ? ' It may not be playing at that cinema that day — want to try another cinema or date?'
          : ' Want to try another date?';
      return {
        ...base,
        assistantMessage: `No sessions found for ${state.selectedMovie.title} ${scope}.${fallbackHint}`,
        showtimes: inCinema,
        availableDates,
        suggestedActions: [
          { label: 'Any cinema', message: `Show all cinemas for ${state.selectedMovie.title}` },
          { label: 'Tomorrow', message: 'Show tomorrow instead' },
          { label: 'Clear filters', message: 'Clear the filters' },
        ],
      };
    }
    const cinemasShown = [...new Set(formatFiltered.map((st) => st.cinemaName))];
    return {
      ...base,
      assistantMessage:
        `${state.selectedMovie.title} — ${formatFiltered.length} session(s) ` +
        `${state.selectedCinema ? `at ${state.selectedCinema.name}` : `across ${cinemasShown.length} cinema(s)`} ` +
        `on ${formatDateLabel(date, now)}. Pick a time and I'll take you to VOX to book.`,
      showtimes: formatFiltered,
      availableDates,
      movies: [state.selectedMovie],
      suggestedActions: formatFiltered.slice(0, 3).map((st) => ({
        label: `${st.timeLabel} · ${st.formatLabel}${state.selectedCinema ? '' : ` · ${st.cinemaName}`}`,
        message: `Book the ${st.timeLabel} show at ${st.cinemaName}`,
      })),
    };
  }

  /* Catalog browse. */
  if (input.message && (intent === 'search_movie' || intent === 'discover_movie' || intent === 'unknown')) {
    // Free-text query support when no exact movie was resolved.
    if (!entities.movie && intent !== 'discover_movie') {
      const q = input.message.replace(/\b(show|me|movies?|films?|watch|want|to|i|any|whats|what's|on|available)\b/gi, ' ').trim();
      if (q.length >= 3 && !filters.language && !filters.genre && !filters.familySafe && !entities.date?.date) {
        filters.query = q;
      }
    }
  }
  const results = await services.vox.discover(filters);
  if (results.length === 0) {
    const active = describeFilters(filters);
    return {
      ...base,
      assistantMessage:
        `I checked VOX and found no movies matching ${active || 'that'}. ` +
        'Nothing is hidden — that combination genuinely has no sessions. Try relaxing a filter?',
      moviesWithShowtimes: [],
      suggestedActions: [
        { label: 'Clear filters', message: 'Clear the filters' },
        { label: "What's on today", message: "What's on today?" },
      ],
    };
  }
  const active = describeFilters(filters);
  return {
    ...base,
    assistantMessage:
      `Found ${results.length} movie(s)${active ? ` for ${active}` : ' now showing at VOX Cinemas UAE'}. ` +
      'Tap a movie for details, or tell me which one you like.',
    moviesWithShowtimes: results,
    suggestedActions: results.slice(0, 3).map((m) => ({
      label: m.title.length > 28 ? `${m.title.slice(0, 27)}…` : m.title,
      message: `Tell me about ${m.title}`,
    })),
  };
}

function describeFilters(f: FilterState): string {
  const parts: string[] = [];
  if (f.query) parts.push(`"${f.query}"`);
  if (f.familySafe) parts.push('family-safe');
  if (f.language) parts.push(f.language);
  if (f.genre) parts.push(f.genre);
  if (f.format) parts.push(f.format);
  if (f.cinemaId) parts.push(`at ${f.cinemaId.replaceAll('-', ' ')}`);
  if (f.date) parts.push(formatDateLabel(f.date));
  if (f.timeFromMinutes !== undefined) parts.push(`after ${formatMinutes(f.timeFromMinutes)}`);
  return parts.join(', ');
}

function defaultSuggestions(state: ConversationState): SuggestedAction[] {
  if (state.selectedMovie) {
    return [
      { label: 'Showtimes', message: `Show showtimes for ${state.selectedMovie.title}` },
      { label: 'Change movie', message: "What else is on?" },
    ];
  }
  return [
    { label: "What's on tonight", message: "What's on tonight?" },
    { label: 'Family movies', message: 'Show family movies' },
    { label: 'Malayalam movies', message: 'Any Malayalam movies?' },
  ];
}

function similarName(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  return na.includes(nb) || nb.includes(na);
}
