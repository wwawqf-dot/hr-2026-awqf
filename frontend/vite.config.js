import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
// `base` must match the GitHub Pages project sub-path or the deployed site
// requests its JS/CSS from the domain root and 404s (blank page). Defaulting
// to '/hr-2026-awqf/' for any production build — regardless of how it was
// triggered — is safer than relying on a VITE_BASE env var that's easy to
// forget to set; VITE_BASE still overrides it if ever needed (e.g. a repo
// rename). Dev server keeps serving at '/' so `npm run dev` is unaffected.
export default defineConfig(({ command }) => ({
    base: command === 'build' ? (process.env.VITE_BASE || '/hr-2026-awqf/') : '/',
    plugins: [react()],
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        outDir: 'dist',
    },
}));
