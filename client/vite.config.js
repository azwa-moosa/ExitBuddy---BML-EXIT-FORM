import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the React app runs on :5173 and forwards /api to the Express server.
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
