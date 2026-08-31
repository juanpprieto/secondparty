import { reactRouter } from '@react-router/dev/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [reactRouter()],
  resolve: { alias: { '~': new URL('./app', import.meta.url).pathname } },
})
