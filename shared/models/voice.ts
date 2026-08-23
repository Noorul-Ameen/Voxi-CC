export type VoiceSessionStatus =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'disconnected'
  | 'timeout'
  | 'error';

export interface VoiceSession {
  status: VoiceSessionStatus;
  conversationId?: string;
  agentId?: string;
  error?: string;
  startedAt?: string;
}

export interface VoiceTranscript {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
  timestamp: string;
}

/** Response of POST /api/voice/session. Exactly one of the two connection
 *  modes is returned; neither exposes the private API key. */
export type VoiceSessionGrant =
    | { mode: 'signed_url'; signedUrl: string; agentId: string; serverLocation?: string }
  | { mode: 'public_agent'; agentId: string; serverLocation?: string };
