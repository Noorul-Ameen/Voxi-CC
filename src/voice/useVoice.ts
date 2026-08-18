/** Voice orchestration hook.
 *
 * Bridges the ElevenLabs conversation session and the shared store:
 *  - transcripts (user speech + agent replies) land in the SAME chat history
 *  - UI selection changes are pushed to the agent as contextual updates
 *  - agent client-tool calls mutate the SAME conversation state via the
 *    deterministic engine (sendMessage), so voice can never fork the journey
 *  - all lifecycle states are surfaced; failures degrade to text-only chat
 */

import { useCallback, useEffect, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';
import { useStore } from '../state/store';
import { buildAgentContext, describeStateForAgent, fetchVoiceGrant } from './voiceService';

const SESSION_START_TIMEOUT_MS = 15_000;

export function useVoice() {
  const voiceStatus = useStore((s) => s.voiceStatus);
  const setVoiceStatus = useStore((s) => s.setVoiceStatus);
  const addVoiceTranscript = useStore((s) => s.addVoiceTranscript);
  const sendMessage = useStore((s) => s.sendMessage);
  const startingRef = useRef(false);
  const activeRef = useRef(false);
  const lastContextRef = useRef('');

  const conversation = useConversation({
    onConnect: () => {
      setVoiceStatus('connected');
    },
    onDisconnect: () => {
      activeRef.current = false;
      setVoiceStatus('disconnected');
    },
    onError: (message: unknown) => {
      activeRef.current = false;
      setVoiceStatus('error', typeof message === 'string' ? message : 'Voice error');
    },
    onMessage: ({ message, source }: { message: string; source: string }) => {
      // Single shared transcript history; store dedupes echoes.
      addVoiceTranscript(source === 'user' ? 'user' : 'assistant', message);
    },
    onModeChange: ({ mode }: { mode: string }) => {
      if (!activeRef.current) return;
      setVoiceStatus(mode === 'speaking' ? 'speaking' : 'listening');
    },
    clientTools: {
      /** Agent-driven journey actions run through the SAME engine as text. */
      run_conversation_action: async (params: unknown) => {
        const message =
          typeof params === 'object' && params !== null && 'message' in params
            ? String((params as { message: unknown }).message)
            : '';
        if (!message) return 'No action message provided.';
        const res = await sendMessage(message, 'voice');
        return res
          ? `Done. journey_stage=${res.updatedConversationState.currentJourneyStage}. ${res.assistantMessage}`
          : 'The action failed — the movie service was unreachable.';
      },
    },
  });

  /* Keep the agent's context in sync with UI/journey state changes. */
  const conversationState = useStore((s) => s.conversation);
  useEffect(() => {
    if (!activeRef.current || conversation.status !== 'connected') return;
    const snapshot = describeStateForAgent(conversationState);
    if (snapshot === lastContextRef.current) return;
    lastContextRef.current = snapshot;
    try {
      conversation.sendContextualUpdate(snapshot);
    } catch {
      // Non-fatal: context sync is best-effort.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationState, conversation.status]);

  const start = useCallback(async () => {
    // Single-session guard: never start twice.
    if (startingRef.current || activeRef.current) return;
    startingRef.current = true;
    setVoiceStatus('requesting_permission');
    try {
      // Explicit user gesture happened (button click) — now request the mic.
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      startingRef.current = false;
      setVoiceStatus('error', 'Microphone permission was denied. You can continue using chat.');
      return;
    }
    setVoiceStatus('connecting');
    try {
      const grant = await fetchVoiceGrant();
      const dynamicVariables = buildAgentContext(useStore.getState().conversation);
      const timeout = setTimeout(() => {
        if (!activeRef.current) {
          startingRef.current = false;
          setVoiceStatus('timeout', 'Voice connection timed out. You can continue using chat.');
          try {
            conversation.endSession();
          } catch { /* already closed */ }
        }
      }, SESSION_START_TIMEOUT_MS);
      activeRef.current = true;
      if (grant.mode === 'signed_url') {
        conversation.startSession({ signedUrl: grant.signedUrl, dynamicVariables });
      } else {
        conversation.startSession({
          agentId: grant.agentId,
          connectionType: 'websocket',
          dynamicVariables,
        });
      }
      // Connection confirmation arrives via onConnect; clear timer there too.
      const clearOnConnect = setInterval(() => {
        if (conversation.status === 'connected') {
          clearTimeout(timeout);
          clearInterval(clearOnConnect);
        }
      }, 500);
    } catch (err) {
      activeRef.current = false;
      setVoiceStatus('error', err instanceof Error ? err.message : 'Voice is unavailable.');
    } finally {
      startingRef.current = false;
    }
  }, [conversation, setVoiceStatus]);

  const stop = useCallback(() => {
    activeRef.current = false;
    try {
      conversation.endSession();
    } catch { /* already closed */ }
    setVoiceStatus('idle');
  }, [conversation, setVoiceStatus]);

  return {
    status: voiceStatus,
    error: useStore((s) => s.voiceError),
    isSpeaking: conversation.isSpeaking,
    start,
    stop,
    retry: start,
  };
}
