import type { Cinema, Movie, MovieFormat, Showtime } from './movie';
import type { FilterState } from './filters';
import type { SeatSelection, TicketSelection, FoodSelection } from './commerce';

export type ConversationIntent =
  | 'discover_movie'
  | 'search_movie'
  | 'filter_movies'
  | 'select_movie'
  | 'select_cinema'
  | 'change_cinema'
  | 'select_date'
  | 'change_date'
  | 'select_showtime'
  | 'change_showtime'
  | 'request_ticket'
  | 'request_seat'
  | 'request_food'
  | 'request_payment'
  | 'request_booking'
  | 'request_booking_history'
  | 'request_cancellation'
  | 'request_refund'
  | 'ask_movie_question'
  | 'ask_cinema_question'
  | 'reset_conversation'
  | 'greeting'
  | 'help'
  | 'unknown';

export type JourneyStage =
  | 'discovery'
  | 'movie_selected'
  | 'cinema_selected'
  | 'date_selected'
  | 'showtime_selected'
  | 'tickets'
  | 'seats'
  | 'food'
  | 'payment'
  | 'booking'
  | 'booking_management';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** How the message entered the conversation. Voice + text share one history. */
  channel: 'text' | 'voice';
  timestamp: string; // ISO
  intent?: ConversationIntent;
}

export interface CustomerContext {
  /** Reserved for future loyalty/account integration. Never fabricated. */
  loyaltyMemberId?: string;
  displayName?: string;
}

/** Single source of truth for the customer journey. */
export interface ConversationState {
  conversationId: string;
  selectedMovie?: Movie;
  selectedCinema?: Cinema;
  /** Dubai-local calendar date YYYY-MM-DD. */
  selectedDate?: string;
  selectedShowtime?: Showtime;
  selectedFormat?: MovieFormat;
  selectedTickets: TicketSelection[];
  selectedSeats: SeatSelection[];
  foodSelection: FoodSelection[];
  activeFilters: FilterState;
  locale: string;
  timezone: string; // always "Asia/Dubai"
  currentJourneyStage: JourneyStage;
  customerContext?: CustomerContext;
}

export interface SuggestedAction {
  label: string;
  /** Message sent to the conversation API when the chip is tapped. */
  message: string;
}

export interface ConversationRequest {
  message: string;
  conversationId?: string;
  state?: Partial<ConversationState>;
  locale?: string;
  timezone?: string;
  /** Channel the message arrived on. */
  channel?: 'text' | 'voice';
}

export interface ConversationResponse {
  assistantMessage: string;
  detectedIntent: ConversationIntent;
  updatedConversationState: ConversationState;
  movies?: Movie[];
  moviesWithShowtimes?: import('./movie').MovieWithShowtimes[];
  cinemas?: Cinema[];
  showtimes?: Showtime[];
  availableDates?: string[];
  suggestedActions: SuggestedAction[];
  structuredError?: import('./errors').ApiError;
}
