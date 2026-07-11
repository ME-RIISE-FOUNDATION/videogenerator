import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Everything server-side lives on :5000; the dev client proxies API calls,
// the Socket.io websocket, and the rendered-video static route to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/output': 'http://localhost:5000',
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
});
