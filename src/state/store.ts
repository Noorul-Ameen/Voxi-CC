/** Global UI store — one synchronized source of truth.
 *
 * ConversationState (journey selections + filters) lives here alongside the
 * shared chat transcript and async UI status. Chat, voice, movie cards and
 * selector controls all read and write THIS store; nothing keeps a private
 * copy of journey state. Every user interaction funnels through
 * `sendMessage`, so the deterministic engine on the Worker is the only thing
 * that mutates journey state — guaranteeing chat, voice and UI never
 * contradict each other.
 */

import { create } from 'zustand';
import type {
  Cinema,
  ConversationMessage,
  ConversationResponse,
  ConversationState,
  MovieWithShowtimes,
  Showtime,
  SuggestedAction,
  VoiceSessionStatus,
  ApiError,
  Movie,
} from '@shared/models';
import { UAE_TIMEZONE, uid } from '@shared/utils';
import { api, ApiClientError } from '../services/apiClient';

export type PanelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface StoreState {
  conversation: ConversationState;
  messages: ConversationMessage[];
  suggestedActions: SuggestedAction[];
  /** Results panel */
  movies: MovieWithShowtimes[];
  showtimes: Showtime[];
  availableDates: string[];
  cinemas: Cinema[];
  panelStatus: PanelStatus;
  panelError?: ApiError;
  lastFailedMessage?: string;
  sending: boolean;
  /** Voice */
  voiceStatus: VoiceSessionStatus;
  voiceError?: string;

  /* actions */
  init: () => Promise<void>;
  sendMessage: (text: string, channel?: 'text' | 'voice') => Promise<ConversationResponse | undefined>;
  applyResponse: (res: ConversationResponse) => void;
  addVoiceTranscript: (role: 'user' | 'assistant', text: string) => void;
  applyExternalState: (state: Partial<ConversationState>) => void;
  setVoiceStatus: (status: VoiceSessionStatus, error?: string) => void;
  retryLast: () => void;
}

function initialConversation(): ConversationState {
  return {
    conversationId: uid('conv'),
    selectedTickets: [],
    selectedSeats: [],
    foodSelection: [],
    activeFilters: {},
    locale: 'en-AE',
    timezone: UAE_TIMEZONE,
    currentJourneyStage: 'discovery',
  };
}

/** Duplicate-transcript guard: same role + normalized text within 5s. */
function isDuplicate(messages: ConversationMessage[], role: string, text: string): boolean {
  const norm = text.trim().toLowerCase();
  const cutoff = Date.now() - 5000;
  return messages.some(
    (m) =>
      m.role === role &&
      m.content.trim().toLowerCase() === norm &&
      new Date(m.timestamp).getTime() > cutoff,
  );
}

export const useStore = create<StoreState>((set, get) => ({
  conversation: initialConversation(),
  messages: [],
  suggestedActions: [
    { label: "What's on tonight", message: "What's on tonight?" },
    { label: 'Family movies', message: 'Show family movies' },
    { label: 'IMAX movies', message: 'Show IMAX movies tonight' },
  ],
  movies: [],
  showtimes: [],
  availableDates: [],
  cinemas: [],
  panelStatus: 'idle',
  sending: false,
  voiceStatus: 'idle',

  init: async () => {
    set({ panelStatus: 'loading' });
    try {
      const [{ cinemas }, { movies }] = await Promise.all([
        api.getCinemas(),
        api.getMovies({}),
      ]);
      set({
        cinemas,
        movies,
        panelStatus: movies.length > 0 ? 'ready' : 'empty',
      });
    } catch (err) {
      set({
        panelStatus: 'error',
        panelError:
          err instanceof ApiClientError
            ? err.apiError
            : { code: 'INTERNAL', message: 'Could not load movies.', retryable: true },
      });
    }
  },

  sendMessage: async (text, channel = 'text') => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return undefined;
    const userMsg: ConversationMessage = {
      id: uid('msg'),
      role: 'user',
      content: trimmed,
      channel,
      timestamp: new Date().toISOString(),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sending: true,
      panelStatus: 'loading',
      panelError: undefined,
      lastFailedMessage: undefined,
    }));
    try {
      const res = await api.sendConversation({
        message: trimmed,
        conversationId: get().conversation.conversationId,
        state: get().conversation,
        channel,
      });
      get().applyResponse(res);
      return res;
    } catch (err) {
      const apiError =
        err instanceof ApiClientError
          ? err.apiError
          : { code: 'INTERNAL' as const, message: 'Something went wrong.', retryable: true };
      set((s) => ({
        sending: false,
        panelStatus: s.movies.length > 0 || s.showtimes.length > 0 ? 'ready' : 'error',
        panelError: apiError,
        lastFailedMessage: trimmed,
        messages: [
          ...s.messages,
          {
            id: uid('msg'),
            role: 'assistant',
            content: apiError.retryable
              ? "I couldn't reach the movie service just now. Your selections are safe — tap Retry or try again in a moment."
              : apiError.message,
            channel,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
      return undefined;
    }
  },

  applyResponse: (res) => {
    set((s) => {
      const assistantMsg: ConversationMessage = {
        id: uid('msg'),
        role: 'assistant',
        content: res.assistantMessage,
        channel: 'text',
        timestamp: new Date().toISOString(),
        intent: res.detectedIntent,
      };
      const movies =
        res.moviesWithShowtimes ??
        (res.movies?.map((m: Movie) => ({ ...m, showtimes: [] })) ?? undefined);
      const hasResults =
        (movies?.length ?? 0) > 0 || (res.showtimes?.length ?? 0) > 0;
      const receivedResultFields =
        res.moviesWithShowtimes !== undefined || res.movies !== undefined || res.showtimes !== undefined;
      return {
        conversation: res.updatedConversationState,
        messages: isDuplicate(s.messages, 'assistant', res.assistantMessage)
          ? s.messages
          : [...s.messages, assistantMsg],
        suggestedActions: res.suggestedActions,
        movies: movies ?? s.movies,
        showtimes: res.showtimes ?? (receivedResultFields ? [] : s.showtimes),
        availableDates: res.availableDates ?? s.availableDates,
        sending: false,
        panelStatus: receivedResultFields ? (hasResults ? 'ready' : 'empty') : (s.movies.length > 0 ? 'ready' : s.panelStatus === 'loading' ? 'ready' : s.panelStatus),
        panelError: res.structuredError,
      };
    });
  },

  addVoiceTranscript: (role, text) => {
    if (!text.trim()) return;
    set((s) => {
      if (isDuplicate(s.messages, role, text)) return s;
      return {
        messages: [
          ...s.messages,
          {
            id: uid('msg'),
            role,
            content: text.trim(),
            channel: 'voice' as const,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    });
  },

  /** Used by ElevenLabs client tools to push state the agent changed. */
  applyExternalState: (state) => {
    set((s) => ({ conversation: { ...s.conversation, ...state } }));
  },

  setVoiceStatus: (status, error) => set({ voiceStatus: status, voiceError: error }),

  retryLast: () => {
    const { lastFailedMessage } = get();
    if (lastFailedMessage) void get().sendMessage(lastFailedMessage);
    else void get().init();
  },
}));
