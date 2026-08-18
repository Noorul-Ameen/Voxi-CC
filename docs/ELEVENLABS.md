# ElevenLabs Conversational AI Integration

## Agent

**VOXi Concierge — VOX Conversational Commerce** · `agent_1201m0b6kjzje0ctytdqs8t8eae8` (workspace of the project owner; tags `vox-conversational-commerce`, `production-platform`). The agent id is configured per environment via the `ELEVENLABS_AGENT_ID` var in `wrangler.jsonc` — create separate agents per environment when prompts start diverging and just change the var; no code changes are required.

Agent configuration highlights: LLM gemini-2.5-flash, temperature 0, `ignore_default_personality`, public auth (`enable_auth: false`) so the browser can connect with the bare agent id, and hard honesty rules in the prompt (never invent movies/sessions/prices; never claim payment/booking success; direct existing-booking matters to VOX channels).

## SDK usage

The official SDK `@elevenlabs/react` is used only inside the voice service layer:

- `src/App.tsx` wraps the app in `<ConversationProvider>`.
- `src/voice/useVoice.ts` is the ONLY consumer of `useConversation` — lifecycle, transcripts, client tools and contextual updates are bridged to the shared store there.
- `src/voice/voiceService.ts` holds the agent context contract (`buildAgentContext`, `describeStateForAgent`) and grant fetching.
- UI components consume `useVoice()` and know nothing about ElevenLabs.

Changing agent ids, prompts, tools, dynamic variables or models therefore never requires component rewrites.

## Session creation (two modes, key always server-side)

`POST /api/voice/session` (worker/providers/elevenlabs/session.ts):

1. **Signed URL mode** — when the `ELEVENLABS_API_KEY` secret is set, the Worker calls `GET /v1/convai/conversation/get-signed-url?agent_id=…` with `xi-api-key` and returns `{mode:'signed_url', signedUrl}`. The browser starts the session with `startSession({ signedUrl, dynamicVariables })`. Recommended for production (the agent can then have auth enabled).
2. **Public agent mode** — no server key configured: returns `{mode:'public_agent', agentId}`; browser uses `startSession({ agentId, connectionType:'websocket', dynamicVariables })`. Works because the agent has public auth.
3. **Fail-closed** — no agent id: 503 `CAPABILITY_UNAVAILABLE`; the UI shows "Voice is not configured… you can continue using chat."

The private API key never appears in frontend bundles, client env vars, logs or error responses.

## Dynamic variables (context contract)

Sent on session start and templated into the agent prompt. Names are the contract between `buildAgentContext` and the agent config — change both together:

```
conversation_id, movie_id, movie_title, cinema_id, cinema_name,
selected_date, session_id, showtime, format, locale, timezone, journey_stage
```

## Tools

**Client tool `run_conversation_action`** (`expects_response: true`, 30 s timeout, parameter `message: string`). Implemented in `useVoice`'s `clientTools`: it calls the store's `sendMessage(message, 'voice')`, i.e. the exact same deterministic engine as typed chat, and returns the engine's result text to the agent. This is why voice and text can never produce divergent journeys. Server-side webhook tools are intentionally not used for journey actions — the client tool keeps the agent bound to *this* user's UI session; add webhook tools later only for user-independent lookups.

## Conversation context sync (UI → agent)

While a session is live, any change to `ConversationState` (from typing, card clicks or selectors) triggers `conversation.sendContextualUpdate("[UI state update] | journey_stage=… | movie=… | …")` (deduplicated against the last snapshot). The agent prompt instructs it to treat the latest update as truth.

## Events & transcript lifecycle

`onMessage({message, source})` → transcripts appended to the SAME chat history as text messages, tagged `channel:'voice'`. The store's duplicate guard (same role + normalized text within 5 s) prevents doubled transcripts and repeated assistant messages. `onModeChange` drives listening/speaking states; `onConnect/onDisconnect/onError` drive the status line.

## Voice lifecycle states

`idle → requesting_permission → connecting → connected ↔ listening/processing/speaking → disconnected`, plus `timeout` and `error`. Microphone access is requested only after the user clicks the mic button (explicit gesture). A 15 s start timeout produces a retryable `timeout` state. A `startingRef`/`activeRef` guard ensures only one session can exist. Every failure path ends with chat fully functional and a "Retry voice" affordance — voice is an enhancement, never a dependency.

## Error & retry behaviour

Grant failures → friendly message ("Voice is temporarily unavailable. You can continue using chat."), status `error`, retry re-runs the full start flow. SDK errors → `error` state without touching conversation state. Mic denial → `error` with guidance, no session attempt.

## CSP note

The SDK's audio worklets load from blob: URLs; the CSP (worker/index.ts and public/_headers) therefore allows `script-src blob:`, `worker-src blob:`, `media-src blob:` and `connect-src wss://*.elevenlabs.io https://*.elevenlabs.io`. If a future SDK version pulls third-party scripts that violate CSP, self-host those assets under `public/` and keep the policy strict rather than loosening it.

## Required environment variables

| Name | Where | Purpose |
|---|---|---|
| `ELEVENLABS_AGENT_ID` | wrangler.jsonc vars (per env) | Which agent voice sessions use |
| `ELEVENLABS_API_KEY` | Cloudflare secret / .dev.vars | Enables signed-URL sessions (optional but recommended in production) |
