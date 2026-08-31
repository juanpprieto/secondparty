import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'node',
    include: ['test/**/*.test.ts'],
    // The shared stub vendor log is cross-file state; keep files serial even
    // when this project runs without the root config.
    fileParallelism: false,
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 15000,
  },
})
