import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Everything server-side lives on :5000; the dev client proxies API calls,
// the Socket.io websocket, and the rendered-video static route to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // timeout/proxyTimeout = 0 → never cut off a slow request. Large video
      // uploads can take minutes to stream through the dev proxy to :5000; the
      // default proxy behavior can drop them mid-flight, surfacing in the app as
      // a bare "Failed to fetch".
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/output': 'http://localhost:5000',
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
});
