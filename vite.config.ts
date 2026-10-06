import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      thresholds: { branches: 100 },
    },
  },
});
