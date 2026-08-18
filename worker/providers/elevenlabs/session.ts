/** Server-side ElevenLabs session minting.
 *
 * The private ELEVENLABS_API_KEY never leaves the Worker. The browser calls
 * POST /api/voice/session and receives either a short-lived signed WebSocket
 * URL (private agents) or, when no key is configured but a public agent id
 * is, the bare agent id. With neither configured the endpoint fails closed
 * with CAPABILITY_UNAVAILABLE and the UI keeps text chat fully functional.
 */

import type { ProviderStatus, VoiceSessionGrant } from '@shared/models';

const ELEVENLABS_API = 'https://api.elevenlabs.io';

export interface ElevenLabsSessionConfig {
  apiKey?: string;
  agentId?: string;
}

export class ElevenLabsSessionService {
  constructor(private readonly config: ElevenLabsSessionConfig) {}

  get configured(): boolean {
    return !!this.config.agentId;
  }

  async createSessionGrant(): Promise<VoiceSessionGrant | { error: string }> {
    const { apiKey, agentId } = this.config;
    if (!agentId) {
      return { error: 'Voice is not configured in this environment.' };
    }
    if (!apiKey) {
      // Public agent mode: the agent must be marked public in ElevenLabs.
      return { mode: 'public_agent', agentId };
    }
    try {
      const res = await fetch(
        `${ELEVENLABS_API}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
        {
          headers: { 'xi-api-key': apiKey },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) {
        // Never include upstream body (may echo key context) in client errors.
        return { error: `Voice session could not be created (upstream ${res.status}).` };
      }
      const body = (await res.json()) as { signed_url?: string };
      if (!body.signed_url || !body.signed_url.startsWith('wss://')) {
        return { error: 'Voice session response was invalid.' };
      }
      return { mode: 'signed_url', signedUrl: body.signed_url, agentId };
    } catch {
      return { error: 'Voice session could not be created (network error).' };
    }
  }

  async checkHealth(): Promise<ProviderStatus> {
    const checkedAt = new Date().toISOString();
    if (!this.config.agentId) {
      return { provider: 'elevenlabs', health: 'not_configured', checkedAt };
    }
    if (!this.config.apiKey) {
      return {
        provider: 'elevenlabs',
        health: 'ok',
        checkedAt,
        detail: 'public agent mode (no server key configured)',
      };
    }
    const start = Date.now();
    const grant = await this.createSessionGrant();
    return {
      provider: 'elevenlabs',
      health: 'error' in grant ? 'unavailable' : 'ok',
      latencyMs: Date.now() - start,
      checkedAt,
    };
  }
}
