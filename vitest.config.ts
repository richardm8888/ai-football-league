import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The end-to-end matchday test drives a real Postgres database and a full season.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    setupFiles: ['tests/setup/env.ts'],
    globalSetup: ['tests/setup/global.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
