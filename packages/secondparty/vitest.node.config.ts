import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'node',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 15000,
  },
})
