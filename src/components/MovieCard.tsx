import type { MovieWithShowtimes } from '@shared/models';
import { useStore } from '../state/store';

function ratingClass(rating?: string): string {
  if (!rating) return '';
  if (['G', 'PG', 'PG13'].includes(rating.toUpperCase())) return 'family';
  if (['18+', '15+', 'PG15'].includes(rating.toUpperCase())) return 'mature';
  return '';
}

export function MovieCard({ movie }: { movie: MovieWithShowtimes }) {
  const selectedId = useStore((s) => s.conversation.selectedMovie?.id);
  const sendMessage = useStore((s) => s.sendMessage);
  const sending = useStore((s) => s.sending);
  const selected = selectedId === movie.id;

  return (
    <button
      className={`movie-card ${selected ? 'selected' : ''}`}
      data-testid="movie-card"
      data-movie-id={movie.id}
      disabled={sending}
      onClick={() => void sendMessage(`Show showtimes for ${movie.title}`)}
      aria-pressed={selected}
    >
      {movie.posterUrl ? (
        <img className="poster" src={movie.posterUrl} alt={`${movie.title} poster`} loading="lazy" />
      ) : (
        <div className="poster-fallback">{movie.title}</div>
      )}
      <span className="card-body">
        <h3>{movie.title}</h3>
        <span className="movie-meta">
          {movie.rating && <span className={`rating-badge ${ratingClass(movie.rating)}`}>{movie.rating}</span>}
          {movie.language && <span>{movie.language}</span>}
          {movie.runtimeMinutes ? <span>{movie.runtimeMinutes} min</span> : null}
          {movie.genres.slice(0, 2).map((g) => (
            <span key={g}>{g}</span>
          ))}
        </span>
        {movie.showtimes.length > 0 && (
          <span className="movie-meta">
            {[...new Set(movie.showtimes.map((st) => st.format))].slice(0, 4).map((f) => (
              <span key={f} style={{ color: 'var(--accent)' }}>{f}</span>
            ))}
            <span>{movie.showtimes.length} session(s)</span>
          </span>
        )}
      </span>
    </button>
  );
}
