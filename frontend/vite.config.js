import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    open: true,
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Connect-Protocol-Version',
        'connect-protocol-version',
        'Connect-Timeout-Ms',
        'Connect-User-Agent',
      ],
      exposedHeaders: ['Content-Type', 'Connect-Protocol-Version'],
    },
    proxy: {
      '/otto.v1': {
        target: 'http://localhost:5234',
        changeOrigin: true,
        secure: false,
      },
      '/sickrock.SickRock': {
        target: 'http://localhost:5234',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

