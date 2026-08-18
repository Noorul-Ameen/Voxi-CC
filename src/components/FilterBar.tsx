import type { MovieFormat } from '@shared/models';
import { useStore } from '../state/store';

const LANGUAGES = ['English', 'Hindi', 'Malayalam', 'Tamil', 'Telugu', 'Arabic'];
const FORMATS: MovieFormat[] = ['STANDARD', 'IMAX', 'MAX', '4DX', 'GOLD', 'THEATRE', 'KIDS'];
const TIMES: { label: string; minutes: number }[] = [
  { label: 'Any time', minutes: -1 },
  { label: 'After 12 PM', minutes: 720 },
  { label: 'After 5 PM', minutes: 1020 },
  { label: 'After 7 PM', minutes: 1140 },
  { label: 'After 9 PM', minutes: 1260 },
];

/** Filter controls — like everything else, they speak to the engine through
 *  natural-language messages so state stays unified. */
export function FilterBar() {
  const cinemas = useStore((s) => s.cinemas);
  const filters = useStore((s) => s.conversation.activeFilters);
  const selectedCinema = useStore((s) => s.conversation.selectedCinema);
  const sendMessage = useStore((s) => s.sendMessage);
  const sending = useStore((s) => s.sending);

  return (
    <div className="filter-bar" data-testid="filter-bar">
      <select
        aria-label="Cinema"
        data-testid="cinema-select"
        disabled={sending}
        value={selectedCinema?.id ?? ''}
        onChange={(e) => {
          const cinema = cinemas.find((c) => c.id === e.target.value);
          void sendMessage(cinema ? `Show movies at ${cinema.name}` : 'Show all cinemas');
        }}
      >
        <option value="">All cinemas</option>
        {cinemas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Language"
        data-testid="language-select"
        disabled={sending}
        value={filters.language ?? ''}
        onChange={(e) =>
          void sendMessage(e.target.value ? `Show ${e.target.value} movies` : 'Clear the filters')
        }
      >
        <option value="">All languages</option>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <select
        aria-label="Format"
        data-testid="format-select"
        disabled={sending}
        value={filters.format ?? ''}
        onChange={(e) =>
          void sendMessage(e.target.value ? `Show ${e.target.value} movies` : 'Clear the filters')
        }
      >
        <option value="">All formats</option>
        {FORMATS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      <select
        aria-label="Time"
        data-testid="time-select"
        disabled={sending}
        value={filters.timeFromMinutes ?? -1}
        onChange={(e) => {
          const minutes = Number(e.target.value);
          const opt = TIMES.find((t) => t.minutes === minutes);
          void sendMessage(
            minutes < 0 ? 'Clear the filters' : `Show movies ${opt!.label.toLowerCase()}`,
          );
        }}
      >
        {TIMES.map((t) => (
          <option key={t.minutes} value={t.minutes}>
            {t.label}
          </option>
        ))}
      </select>

      <button
        className={`filter-toggle ${filters.familySafe ? 'on' : ''}`}
        data-testid="family-safe-toggle"
        disabled={sending}
        aria-pressed={!!filters.familySafe}
        onClick={() =>
          void sendMessage(filters.familySafe ? 'Clear the filters' : 'Show family movies')
        }
      >
        👨‍👩‍👧 Family-safe
      </button>
    </div>
  );
}
