import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ isPreview }) => ({
    plugins: [cloudflare({
        // Dev and preview can run at the same time without sharing SQLite files.
        persistState: { path: isPreview ? '.wrangler/preview-state' : '.wrangler/state' }
    })],
    server: {
        host: '0.0.0.0',
        allowedHosts: ['.e2b.app']
    },
    preview: {
        host: '0.0.0.0',
        allowedHosts: ['.e2b.app']
    }
}));
