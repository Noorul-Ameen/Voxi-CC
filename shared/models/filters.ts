import type { MovieFormat } from './movie';

/** Discovery filters. All fields optional; absent = no constraint. */
export interface FilterState {
  query?: string;
  cinemaId?: string;
  /** Dubai-local calendar date, YYYY-MM-DD. */
  date?: string;
  language?: string;
  genre?: string;
  rating?: string;
  format?: MovieFormat;
  familySafe?: boolean;
  /** Only showtimes at/after this time, minutes since midnight Dubai-local. */
  timeFromMinutes?: number;
}
