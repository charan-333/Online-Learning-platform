import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['test/globalSetup.ts'],
    env: { NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', AI_PROVIDER: 'none' },
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
