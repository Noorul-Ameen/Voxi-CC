/** Provider registry wiring. This is the single place where concrete
 *  implementations are chosen; everything downstream depends on interfaces. */

import type { ProviderRegistry } from './types';
import { VoxClient } from './vox/client';
import { VoxDiscoveryProvider } from './vox/discovery';
import { FailClosedCommerceProvider } from './commerce/failClosed';
import { ElevenLabsSessionService } from './elevenlabs/session';
import type { WorkerEnv } from '../env';

export interface AppServices {
  providers: ProviderRegistry;
  vox: VoxDiscoveryProvider;
  voice: ElevenLabsSessionService;
  env: WorkerEnv;
}

export function createServices(env: WorkerEnv): AppServices {
  const client = new VoxClient({
    baseUrl: env.VOX_BASE_URL || 'https://uae.voxcinemas.com',
    cache: env.VOX_CACHE,
    userAgent: env.VOX_USER_AGENT,
  });
  const vox = new VoxDiscoveryProvider(client);

  // Protected commerce: genuine partner APIs are not configured → fail-closed.
  // When credentials exist, replace with a VistaConnectCommerceProvider here.
  const commerce = new FailClosedCommerceProvider();

  const voice = new ElevenLabsSessionService({
    apiKey: env.ELEVENLABS_API_KEY,
    agentId: env.ELEVENLABS_AGENT_ID,
  });

  return {
    env,
    vox,
    voice,
    providers: {
      movies: vox,
      cinemas: vox,
      showtimes: vox,
      tickets: commerce,
      seats: commerce,
      food: commerce,
      pricing: commerce,
      loyalty: commerce,
      payment: commerce,
      booking: commerce,
      cancellation: commerce,
      refund: commerce,
    },
  };
}
