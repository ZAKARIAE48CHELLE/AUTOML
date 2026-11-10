import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@contracts': path.resolve(__dirname, '../../packages/contracts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: { port: 5173, fs: { allow: ['../..'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
