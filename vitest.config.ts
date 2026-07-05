import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Embedded-postgres startup per DB-backed test file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
