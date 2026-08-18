import { formatDateLabel } from '@shared/utils';
import { useStore } from '../state/store';

/** Breadcrumb of current journey selections with change/clear controls.
 *  Every control routes through the conversation engine so chat + voice +
 *  UI stay synchronized. */
export function JourneyBar() {
  const conversation = useStore((s) => s.conversation);
  const sendMessage = useStore((s) => s.sendMessage);
  const sending = useStore((s) => s.sending);

  const chips: { key: string; label: string; value?: string; clearMsg: string }[] = [
    {
      key: 'movie',
      label: 'Movie',
      value: conversation.selectedMovie?.title,
      clearMsg: 'What else is on?',
    },
    {
      key: 'cinema',
      label: 'Cinema',
      value: conversation.selectedCinema?.name,
      clearMsg: 'Show all cinemas',
    },
    {
      key: 'date',
      label: 'Date',
      value: conversation.selectedDate ? formatDateLabel(conversation.selectedDate) : undefined,
      clearMsg: 'Show today instead',
    },
    {
      key: 'showtime',
      label: 'Time',
      value: conversation.selectedShowtime
        ? `${conversation.selectedShowtime.timeLabel} · ${conversation.selectedShowtime.formatLabel}`
        : undefined,
      clearMsg: 'Show other times',
    },
  ];

  return (
    <div className="journey-bar" data-testid="journey-bar">
      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
        Journey · {conversation.currentJourneyStage.replace('_', ' ')}
      </span>
      {chips.map((chip) => (
        <span key={chip.key} className={`journey-chip ${chip.value ? 'set' : ''}`} data-testid={`journey-${chip.key}`}>
          <span className="label">{chip.label}:</span> {chip.value ?? '—'}
          {chip.value && (
            <button
              aria-label={`Change ${chip.label}`}
              title={`Change ${chip.label}`}
              disabled={sending}
              onClick={() => void sendMessage(chip.clearMsg)}
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {(conversation.selectedMovie || conversation.selectedCinema) && (
        <button
          className="journey-chip"
          style={{ cursor: 'pointer' }}
          disabled={sending}
          onClick={() => void sendMessage('Start over')}
          data-testid="reset-journey"
        >
          Start over
        </button>
      )}
    </div>
  );
}
