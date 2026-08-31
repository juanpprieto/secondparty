import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Pool 0.22 (vitest 4) replaced defineWorkersConfig with the cloudflareTest plugin.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-08-01',
        compatibilityFlags: ['nodejs_compat'],
      },
    }),
  ],
  test: {
    name: 'workerd',
    include: ['test/**/*.test.ts'],
    // The shared stub vendor log is cross-file state; keep files serial even
    // when this project runs without the root config.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'], // runs in the Node host; provide/inject crosses into workerd
    testTimeout: 15000,
  },
})
