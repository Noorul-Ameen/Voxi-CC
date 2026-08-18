import type { ProviderError } from './errors';

/** Commerce models. Protected operations are FAIL-CLOSED: results can only
 *  be produced by genuine upstream VOX success — never simulated as real. */

export interface TicketType {
  code: string;
  name: string;
  priceInCents?: number;
  currency?: string;
  areaCategoryCode?: string;
}

export interface TicketSelection {
  ticketTypeCode: string;
  quantity: number;
}

export interface Seat {
  id: string;
  row: string;
  number: string;
  areaCategoryCode?: string;
  status: 'available' | 'unavailable' | 'sold' | 'blocked';
}

export interface SeatArea {
  areaCategoryCode: string;
  name?: string;
  rows: { row: string; seats: Seat[] }[];
}

export interface SeatLayout {
  sessionId: string;
  areas: SeatArea[];
}

export interface SeatSelection {
  seatId: string;
  areaCategoryCode?: string;
}

export interface FoodItem {
  id: string;
  name: string;
  description?: string;
  priceInCents?: number;
  currency?: string;
  category?: string;
}

export interface FoodSelection {
  itemId: string;
  quantity: number;
}

/** Discriminated result for any commerce operation.
 *  `unavailable` is the REQUIRED result when genuine upstream VOX services
 *  are not configured/reachable — callers must surface it, never mask it. */
export type CommerceResult<T> =
  | { status: 'ok'; data: T; demo?: false }
  | { status: 'demo'; data: T; demoLabel: string }
  | { status: 'unavailable'; reason: string; retryable: boolean }
  | { status: 'error'; error: ProviderError };

export interface BookingResult {
  bookingReference: string;
  cinemaId: string;
  sessionId: string;
  totalInCents: number;
  currency: string;
  confirmedAt: string; // ISO
}
