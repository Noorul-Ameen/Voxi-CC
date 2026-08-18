import type { Showtime } from '@shared/models';
import { formatDateLabel } from '@shared/utils';
import { useStore } from '../state/store';

/** Genuine VOX sessions grouped by cinema → format. Picking one routes
 *  through the engine; the selected session links to VOX's official
 *  booking page (session ids are real, never generated). */
export function ShowtimeList() {
  const showtimes = useStore((s) => s.showtimes);
  const selected = useStore((s) => s.conversation.selectedShowtime);
  const movie = useStore((s) => s.conversation.selectedMovie);
  const sendMessage = useStore((s) => s.sendMessage);
  const sending = useStore((s) => s.sending);

  if (showtimes.length === 0 && !selected) return null;

  const byCinema = new Map<string, Showtime[]>();
  for (const st of showtimes) {
    const list = byCinema.get(st.cinemaName) ?? [];
    list.push(st);
    byCinema.set(st.cinemaName, list);
  }

  return (
    <div className="showtime-section" data-testid="showtime-list">
      {selected && (
        <div className="selected-showtime-card" data-testid="selected-showtime">
          <strong>
            {movie?.title ?? 'Selected session'} — {selected.timeLabel} ({selected.formatLabel})
          </strong>
          <span>
            {selected.cinemaName} · {formatDateLabel(selected.date)} · Session {selected.id}
          </span>
          <a className="cta" href={selected.bookingUrl} target="_blank" rel="noopener noreferrer">
            Complete booking on VOX ↗
          </a>
          <span className="demo-note">
            Ticket purchase happens on VOX's official secure checkout — this assistant never simulates payments or bookings.
          </span>
        </div>
      )}
      {[...byCinema.entries()].map(([cinemaName, sts]) => {
        const byFormat = new Map<string, Showtime[]>();
        for (const st of sts) {
          const list = byFormat.get(st.formatLabel) ?? [];
          list.push(st);
          byFormat.set(st.formatLabel, list);
        }
        return (
          <div key={cinemaName} className="cinema-group" data-testid="cinema-group">
            <h4>{cinemaName}</h4>
            {[...byFormat.entries()].map(([formatLabel, list]) => (
              <div key={formatLabel} className="format-row">
                <span className="format-label">{formatLabel}</span>
                {list.map((st) => (
                  <button
                    key={st.id}
                    className={`showtime-chip ${selected?.id === st.id ? 'selected' : ''}`}
                    data-testid="showtime-chip"
                    disabled={sending}
                    onClick={() => void sendMessage(`Book the ${st.timeLabel} show at ${st.cinemaName}`)}
                  >
                    {st.timeLabel}
                  </button>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
