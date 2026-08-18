import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { fileURLToPath } from 'node:url';

// Vite builds the React SPA and the Cloudflare Worker together.
// `cloudflare()` reads wrangler.jsonc so local dev (`npm run dev`) runs the
// real Worker runtime (workerd) with KV + assets bindings.
export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
});
