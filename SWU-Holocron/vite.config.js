import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().split('T')[0] + ' ' + new Date().toISOString().split('T')[1].split('.')[0] + ' UTC'),
  },
  build: {
    rollupOptions: {
      external: [
        /^scripts\//  // Exclude admin scripts from browser bundle
      ]
    }
  },
  plugins: [
    svgr(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'SWU Holocron - Collection Manager',
        short_name: 'SWU Holocron',
        description: 'Star Wars Unlimited card collection manager with offline support',
        theme_color: '#1f2937',
        background_color: '#111827',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ],
        categories: ['games', 'entertainment', 'utilities'],
        shortcuts: [
          {
            name: 'Open Dashboard',
            short_name: 'Dashboard',
            description: 'View collection statistics',
            url: '/?view=dashboard',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.swu-db\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'swu-api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-storage-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ],
  server: {
    allowedHosts: ['swu.holocronlabs.net', 'swu-holocron-web', 'localhost', '127.0.0.1']
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: ['swu.holocronlabs.net', 'swu-holocron-web', 'localhost', '127.0.0.1']
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './src/test/setup.js',
    // Rules tests need a running Firestore emulator; they have their own
    // config and npm script (see vitest.rules.config.js / npm run test:rules).
    exclude: ['**/node_modules/**', '**/dist/**', 'src/test/rules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.{js,jsx}',
        '**/*.spec.{js,jsx}',
        '**/vite.config.js',
        '**/tailwind.config.js'
      ],
      // A ratchet, not an aspiration. These keys are matched as GLOBS -- the
      // previous values were written as bare directories ('src/services/'),
      // which match no files, so nothing was enforced and `test:ci` passed at
      // any coverage at all while appearing to demand 80%.
      //
      // Each floor sits a few points under what the suite actually achieves, so
      // it catches a regression without failing today. Raise a floor when you
      // raise the coverage; do not lower one to make a run go green.
      thresholds: {
        // measured: 89 lines / 88 branches / 88 functions
        'src/utils/**': {
          lines: 85,
          statements: 85,
          functions: 83,
          branches: 85
        },
        // measured: 70 lines / 74 branches / 44 functions
        'src/services/**': {
          lines: 66,
          statements: 66,
          functions: 40,
          branches: 70
        },
        // measured: 75 lines / 47 branches / 100 functions
        'src/contexts/**': {
          lines: 70,
          statements: 70,
          functions: 90,
          branches: 44
        },
        // measured: 49 lines / 62 branches / 28 functions
        'src/components/**': {
          lines: 45,
          statements: 45,
          functions: 25,
          branches: 58
        }
      }
    },
    testTimeout: 10000,
    maxConcurrency: 5,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false
      }
    }
  }
})
