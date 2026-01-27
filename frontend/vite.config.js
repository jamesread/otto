import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['assets/otto-logo.svg'],
      manifest: {
        name: 'Otto',
        short_name: 'Otto',
        description: 'Otto personal assistant',
        start_url: '/',
        theme_color: '#4a6fa5',
        background_color: '#ffffff',
        display: 'window-controls-overlay',
        display_override: ['window-controls-overlay', 'standalone', 'browser'],
        icons: [
          {
            src: '/assets/otto-logo.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
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

