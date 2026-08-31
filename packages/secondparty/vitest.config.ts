import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['./vitest.node.config.ts'],
    // One shared stub vendor per project: its request log is cross-file state,
    // so test files must not run concurrently.
    fileParallelism: false,
  },
})
