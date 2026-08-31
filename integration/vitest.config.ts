import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./integration/global-setup.ts'],
    fileParallelism: false, // fixed ports: 3100, 8790, 4567
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
