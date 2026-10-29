import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
