/** ElevenLabs voice service layer.
 *
 * The ONLY module that touches the ElevenLabs SDK types directly. UI
 * components consume the `useVoice` hook (see useVoice.ts); the SDK, agent
 * ids, dynamic variables and client tools are wired here so agent/prompt/
 * tool changes never require component rewrites.
 */

import type { ConversationState } from '@shared/models';
import { api, ApiClientError } from '../services/apiClient';

/** Dynamic variables shared with the ElevenLabs agent on session start and
 *  kept current via contextual updates. Field names are part of the agent
 *  configuration contract — see docs/ELEVENLABS.md. */
export interface AgentContext extends Record<string, string | number | boolean> {
  conversation_id: string;
  movie_id: string;
  movie_title: string;
  cinema_id: string;
  cinema_name: string;
  selected_date: string;
  session_id: string;
  showtime: string;
  format: string;
  locale: string;
  timezone: string;
  journey_stage: string;
}

export function buildAgentContext(state: ConversationState): AgentContext {
  return {
    conversation_id: state.conversationId,
    movie_id: state.selectedMovie?.id ?? '',
    movie_title: state.selectedMovie?.title ?? '',
    cinema_id: state.selectedCinema?.id ?? '',
    cinema_name: state.selectedCinema?.name ?? '',
    selected_date: state.selectedDate ?? '',
    session_id: state.selectedShowtime?.id ?? '',
    showtime: state.selectedShowtime?.timeLabel ?? '',
    format: state.selectedFormat ?? '',
    locale: state.locale,
    timezone: state.timezone,
    journey_stage: state.currentJourneyStage,
  };
}

/** Human-readable context snapshot pushed to the agent when UI state changes
 *  while a voice session is live. */
export function describeStateForAgent(state: ConversationState): string {
  const parts: string[] = ['[UI state update]'];
  parts.push(`journey_stage=${state.currentJourneyStage}`);
  if (state.selectedMovie) parts.push(`movie=${state.selectedMovie.title} (${state.selectedMovie.id})`);
  if (state.selectedCinema) parts.push(`cinema=${state.selectedCinema.name} (${state.selectedCinema.id})`);
  if (state.selectedDate) parts.push(`date=${state.selectedDate}`);
  if (state.selectedShowtime)
    parts.push(`showtime=${state.selectedShowtime.timeLabel} session=${state.selectedShowtime.id}`);
  const f = state.activeFilters;
  const filters = [f.language, f.genre, f.format, f.familySafe ? 'family-safe' : undefined]
    .filter(Boolean)
    .join(',');
  if (filters) parts.push(`filters=${filters}`);
  return parts.join(' | ');
}

export type VoiceGrant =
    | { mode: 'signed_url'; signedUrl: string; agentId: string; serverLocation?: string }
  | { mode: 'public_agent'; agentId: string; serverLocation?: string };

/** Obtain a voice session grant from the Worker (which holds the API key).
 *  Throws a user-presentable Error when voice is unavailable. */
export async function fetchVoiceGrant(): Promise<VoiceGrant> {
  try {
    return await api.createVoiceSession();
  } catch (err) {
    if (err instanceof ApiClientError) {
      throw new Error(
        err.apiError.code === 'CAPABILITY_UNAVAILABLE'
          ? 'Voice is not configured in this environment. You can continue using chat.'
          : 'Voice is temporarily unavailable. You can continue using chat.',
        { cause: err },
      );
    }
    throw new Error('Voice is temporarily unavailable. You can continue using chat.', { cause: err });
  }
}
