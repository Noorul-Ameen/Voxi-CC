/** Worker environment bindings. Secrets are set via `wrangler secret put`
 *  (or .dev.vars locally) and are never exposed to the client. */
export interface WorkerEnv {
  ASSETS: Fetcher;
  VOX_CACHE: KVNamespace;
  ENVIRONMENT: 'development' | 'staging' | 'production';
  VOX_BASE_URL: string;
  VOX_ASSETS_URL: string;
  VOX_PARTNER_API_BASE_URL: string;
  ELEVENLABS_AGENT_ID: string;
  /** ElevenLabs data-residency region: global | us | eu-residency | in-residency. */
  ELEVENLABS_SERVER_LOCATION?: string;
  /** Optional User-Agent override for VOX fetches (empty = runtime default). */
  VOX_USER_AGENT?: string;
  COMMERCE_MODE: 'demo' | 'production';
  // Secrets (optional at runtime; features fail closed without them)
  ELEVENLABS_API_KEY?: string;
  MONITORING_SECRET?: string;
  VOX_API_KEY?: string;
  VOX_CLIENT_SECRET?: string;
}
