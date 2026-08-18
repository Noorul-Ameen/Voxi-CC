import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useVoice } from '../voice/useVoice';

export function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const suggestedActions = useStore((s) => s.suggestedActions);
  const sending = useStore((s) => s.sending);
  const sendMessage = useStore((s) => s.sendMessage);
  const [draft, setDraft] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);
  const voice = useVoice();

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  const submit = (text: string) => {
    if (!text.trim()) return;
    setDraft('');
    void sendMessage(text);
  };

  const voiceActive = ['connected', 'listening', 'processing', 'speaking', 'connecting', 'requesting_permission'].includes(voice.status);

  const voiceStatusLabel: string | undefined = (() => {
    switch (voice.status) {
      case 'requesting_permission': return 'Requesting microphone permission…';
      case 'connecting': return 'Connecting voice…';
      case 'connected': return 'Voice connected — say something!';
      case 'listening': return 'Listening…';
      case 'processing': return 'Thinking…';
      case 'speaking': return 'Assistant speaking…';
      case 'timeout': return voice.error ?? 'Voice timed out. You can continue using chat.';
      case 'error': return voice.error ?? 'Voice is unavailable. You can continue using chat.';
      case 'disconnected': return 'Voice ended. Chat is still available.';
      default: return undefined;
    }
  })();

  return (
    <section className="chat-panel" aria-label="Conversation">
      <div className="chat-history" ref={historyRef} data-testid="chat-history">
        {messages.length === 0 && (
          <p className="chat-empty">
            Ask me anything about VOX Cinemas UAE — movies, showtimes, cinemas.
            <br />
            <em>“Any Malayalam movies tonight?” · “Show IMAX movies at MOE tomorrow”</em>
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`} data-testid={`message-${m.role}`}>
            {m.content}
            {m.channel === 'voice' && <span className="channel-tag">🎙 voice</span>}
          </div>
        ))}
        {sending && <div className="typing-indicator" data-testid="typing">Assistant is thinking</div>}
      </div>

      {voiceStatusLabel && (
        <div className={`voice-status ${voice.status === 'error' || voice.status === 'timeout' ? 'error' : ''}`} data-testid="voice-status">
          {voiceStatusLabel}
          {(voice.status === 'error' || voice.status === 'timeout' || voice.status === 'disconnected') && (
            <>
              {' '}
              <button className="link-btn" style={{ background: 'none', border: 'none', color: 'var(--accent)' }} onClick={() => void voice.retry()}>
                Retry voice
              </button>
            </>
          )}
        </div>
      )}

      <div className="suggested-actions" data-testid="suggested-actions">
        {suggestedActions.map((a) => (
          <button key={a.label} onClick={() => submit(a.message)} disabled={sending}>
            {a.label}
          </button>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <button
          type="button"
          className={`voice-btn ${voiceActive ? 'active' : ''} ${voice.isSpeaking ? 'speaking' : ''}`}
          aria-label={voiceActive ? 'Stop voice' : 'Start voice'}
          title={voiceActive ? 'Stop voice' : 'Start voice conversation'}
          data-testid="voice-toggle"
          onClick={() => (voiceActive ? voice.stop() : void voice.start())}
        >
          {voiceActive ? '◼' : '🎙'}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about movies, cinemas, showtimes…"
          aria-label="Message"
          data-testid="chat-input"
          maxLength={1000}
        />
        <button className="send-btn" type="submit" disabled={sending || !draft.trim()} data-testid="send-button">
          Send
        </button>
      </form>
    </section>
  );
}
