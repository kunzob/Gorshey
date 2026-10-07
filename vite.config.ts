import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false, // registered by src/pwa/updates.ts, production only
      manifest: false, // the web app manifest is hand-written: public/manifest.webmanifest
      devOptions: { enabled: false }, // no service worker under npm run dev
      injectManifest: {
        // Shell only. No *.json pattern: public/manifest.json is the TRACK manifest (network-first at runtime).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}', 'fonts/OFL.txt'],
        globIgnores: ['manifest.json', 'artwork/**', '**/*.md', 'sw.js'],
      },
    }),
  ],
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      thresholds: { branches: 100 },
    },
  },
});
