import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        hmr: false
      },
      plugins: [
        react(), 
        tailwindcss(),
        nodePolyfills(),
        VitePWA({
          registerType: 'prompt',
          injectRegister: 'auto',
          devOptions: {
            enabled: true,
            type: 'module',
          },
          manifest: {
            name: 'Animato: Ultimate Mobile Animation Studio',
            short_name: 'Animato',
            description: 'The ultimate offline-first animation studio',
            theme_color: '#050505',
            background_color: '#050505',
            display: 'standalone',
            icons: [
              {
                src: '/pwa-192x192.png',
                sizes: '192x192',
                type: 'image/png'
              },
              {
                src: '/pwa-512x512.png',
                sizes: '512x512',
                type: 'image/png'
              }
            ]
          },
          workbox: {
            maximumFileSizeToCacheInBytes: 5242880, // 5MB instead of 40MB
            globPatterns: ['**/*.{js,css,html,ico,png,json}'], // removed binary model extensions
            globIgnores: ['**/ort*'],
            navigateFallback: '/index.html',
            navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'google-fonts-cache',
                  expiration: {
                    maxEntries: 10,
                    maxAgeSeconds: 60 * 60 * 24 * 30 // <== 30 days
                  }
                }
              },
              {
                urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@imgly\/.*/i,
                handler: 'StaleWhileRevalidate',
                options: {
                  cacheName: 'imgly-models',
                  expiration: {
                    maxEntries: 50,
                    maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
                  }
                }
              }
            ]
          }
        })
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
