import { useEffect } from 'react';
import { ConversationProvider } from '@elevenlabs/react';
import { useStore } from './state/store';
import { ChatPanel } from './components/ChatPanel';
import { DiscoveryPanel } from './components/DiscoveryPanel';

export default function App() {
  const init = useStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <ConversationProvider>
      <div className="app">
        <header className="app-header">
          <h1>
            <span className="brand">VOX</span> Conversational Commerce
          </h1>
          <span className="env-badge">UAE · Asia/Dubai</span>
        </header>
        <ChatPanel />
        <DiscoveryPanel />
      </div>
    </ConversationProvider>
  );
}
