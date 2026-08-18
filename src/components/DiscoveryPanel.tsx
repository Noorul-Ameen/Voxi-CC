import { useStore } from '../state/store';
import { JourneyBar } from './JourneyBar';
import { FilterBar } from './FilterBar';
import { DateStrip } from './DateStrip';
import { MovieCard } from './MovieCard';
import { ShowtimeList } from './ShowtimeList';

function Skeletons() {
  return (
    <div className="skeleton-grid" data-testid="loading-skeleton" aria-label="Loading movies">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton-card" />
      ))}
    </div>
  );
}

export function DiscoveryPanel() {
  const panelStatus = useStore((s) => s.panelStatus);
  const panelError = useStore((s) => s.panelError);
  const movies = useStore((s) => s.movies);
  const showtimes = useStore((s) => s.showtimes);
  const retryLast = useStore((s) => s.retryLast);

  return (
    <section className="discovery-panel" aria-label="Movie discovery">
      <JourneyBar />
      <FilterBar />
      <DateStrip />

      {panelError && panelStatus !== 'loading' && (
        <div className="error-banner" role="alert" data-testid="error-banner">
          <span>{panelError.message}</span>
          {panelError.retryable && (
            <button onClick={retryLast} data-testid="retry-button">
              Retry
            </button>
          )}
        </div>
      )}

      {/* Loading: never show "no movies" while a request is in flight. */}
      {panelStatus === 'loading' && <Skeletons />}

      {panelStatus === 'error' && !panelError && (
        <div className="state-box" data-testid="error-state">
          Something went wrong loading movies.
          <br />
          <button className="retry-btn" onClick={retryLast}>
            Retry
          </button>
        </div>
      )}
      {panelStatus === 'error' && panelError && movies.length === 0 && (
        <div className="state-box" data-testid="error-state">
          Movie data is temporarily unavailable — nothing is wrong with your selections.
          <br />
          <button className="retry-btn" onClick={retryLast}>
            Retry
          </button>
        </div>
      )}

      {/* Genuine empty result — only after a completed request. */}
      {panelStatus === 'empty' && (
        <div className="state-box" data-testid="empty-state">
          No movies match these filters right now — that's a genuine VOX result, not an error.
          Try relaxing a filter or picking another date.
        </div>
      )}

      {panelStatus === 'ready' && (
        <>
          <ShowtimeList />
          {movies.length > 0 && (
            <>
              <div className="section-title">
                {showtimes.length > 0 ? 'Movie' : 'Now showing at VOX Cinemas UAE'}
              </div>
              <div className="movie-grid" data-testid="movie-grid">
                {movies.map((m) => (
                  <MovieCard key={m.id} movie={m} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
