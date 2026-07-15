import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
// `base` must match the GitHub Pages sub-path (`/<repo-name>/`) or the
// built site loads a blank page. The Actions workflow sets VITE_BASE to
// `/${repo}/` automatically; local dev falls back to '/'.
export default defineConfig({
    base: process.env.VITE_BASE || '/',
    plugins: [react()],
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        outDir: 'dist',
    },
});
