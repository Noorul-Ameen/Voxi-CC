import { addDays, formatDateLabel, nowInDubai } from '@shared/utils';
import { useStore } from '../state/store';

/** Date selector: shows VOX-published available dates for the selected
 *  movie when known, otherwise the next 8 days (Dubai-local). */
export function DateStrip() {
  const availableDates = useStore((s) => s.availableDates);
  const selectedDate = useStore((s) => s.conversation.selectedDate);
  const selectedMovie = useStore((s) => s.conversation.selectedMovie);
  const sendMessage = useStore((s) => s.sendMessage);
  const sending = useStore((s) => s.sending);

  const today = nowInDubai().date;
  const dates =
    selectedMovie && availableDates.length > 0
      ? availableDates
      : Array.from({ length: 8 }, (_, i) => addDays(today, i));

  return (
    <div className="date-strip" data-testid="date-strip" role="tablist" aria-label="Date">
      {dates.map((date) => (
        <button
          key={date}
          role="tab"
          aria-selected={selectedDate === date}
          className={selectedDate === date ? 'selected' : ''}
          disabled={sending}
          data-testid={`date-${date}`}
          onClick={() => void sendMessage(`Show ${formatDateLabel(date) === 'Today' ? 'today' : formatDateLabel(date) === 'Tomorrow' ? 'tomorrow' : `on ${formatDateLabel(date)}`}`)}
        >
          {formatDateLabel(date)}
        </button>
      ))}
    </div>
  );
}
