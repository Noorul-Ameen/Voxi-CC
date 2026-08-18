/** Typed provider interfaces — the seam between normalized application
 *  models and any upstream implementation (VOX public site today, official
 *  Vista Connect / MAF partner APIs tomorrow). The frontend and conversation
 *  engine depend ONLY on these interfaces. */

import type {
  Cinema,
  CommerceResult,
  BookingResult,
  FilterState,
  FoodItem,
  Movie,
  MovieWithShowtimes,
  ProviderStatus,
  SeatLayout,
  Showtime,
  TicketType,
} from '@shared/models';

export interface MovieDiscoveryProvider {
  /** Movies now showing (optionally coming soon), unfiltered. */
  listMovies(status?: 'now_showing' | 'coming_soon'): Promise<Movie[]>;
  /** Single movie with full metadata. */
  getMovie(movieId: string): Promise<Movie | undefined>;
  /** Filtered discovery incl. fuzzy title search. */
  discover(filters: FilterState): Promise<MovieWithShowtimes[]>;
}

export interface CinemaProvider {
  listCinemas(): Promise<Cinema[]>;
  getCinema(cinemaId: string): Promise<Cinema | undefined>;
}

export interface ShowtimeProvider {
  /** Showtimes for a movie on a Dubai-local date across all cinemas. */
  getShowtimesForMovie(movieId: string, date: string): Promise<Showtime[]>;
  /** Showtimes for a cinema on a Dubai-local date across all movies. */
  getShowtimesForCinema(cinemaId: string, date: string): Promise<Showtime[]>;
  /** Dates the provider can serve for a movie (from VOX date navigation). */
  getAvailableDates(movieId: string): Promise<string[]>;
}

/* ── Protected commerce capabilities ──────────────────────────────────────
 * These REQUIRE genuine, authorized VOX/Vista partner APIs. Implementations
 * must fail closed: no credentials / no upstream success → `unavailable`,
 * never a fabricated success. */

export interface TicketProvider {
  getTicketTypes(cinemaId: string, sessionId: string): Promise<CommerceResult<TicketType[]>>;
}

export interface SeatProvider {
  getSeatLayout(cinemaId: string, sessionId: string): Promise<CommerceResult<SeatLayout>>;
  lockSeats(cinemaId: string, sessionId: string, seatIds: string[]): Promise<CommerceResult<{ locked: string[] }>>;
}

export interface FoodProvider {
  getFoodItems(cinemaId: string): Promise<CommerceResult<FoodItem[]>>;
}

export interface PricingProvider {
  getOrderTotal(order: unknown): Promise<CommerceResult<{ totalInCents: number; currency: string }>>;
}

export interface LoyaltyProvider {
  getBalance(memberId: string): Promise<CommerceResult<{ points: number }>>;
  redeem(memberId: string, points: number): Promise<CommerceResult<{ redeemed: number }>>;
}

export interface PaymentProvider {
  pay(order: unknown): Promise<CommerceResult<{ paymentReference: string }>>;
}

export interface BookingProvider {
  createBooking(order: unknown): Promise<CommerceResult<BookingResult>>;
  getBookingHistory(customerRef: string): Promise<CommerceResult<BookingResult[]>>;
}

export interface CancellationProvider {
  cancelBooking(bookingReference: string): Promise<CommerceResult<{ cancelled: true }>>;
}

export interface RefundProvider {
  refundBooking(bookingReference: string): Promise<CommerceResult<{ refunded: true }>>;
}

/** Anything that can report health for /api/monitoring/status. */
export interface HealthCheckable {
  checkHealth(): Promise<ProviderStatus>;
}

/** Full provider registry the API layer is constructed with. */
export interface ProviderRegistry {
  movies: MovieDiscoveryProvider & HealthCheckable;
  cinemas: CinemaProvider & HealthCheckable;
  showtimes: ShowtimeProvider & HealthCheckable;
  tickets: TicketProvider;
  seats: SeatProvider;
  food: FoodProvider;
  pricing: PricingProvider;
  loyalty: LoyaltyProvider;
  payment: PaymentProvider;
  booking: BookingProvider;
  cancellation: CancellationProvider;
  refund: RefundProvider;
}
