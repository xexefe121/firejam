import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.FIREJAM_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Older Fire OS devices ship Chromium-based WebViews from around Chrome 70; lower syntax and CSS to match.
  build: { target: 'es2018', cssTarget: 'chrome69', chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: server, ws: true },
      '/api': server,
      '/media': server,
    },
  },
});
