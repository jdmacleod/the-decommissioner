import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 88, functions: 70, branches: 84, statements: 88 },
      exclude: [
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        '**/*.d.ts',
        'src/App.tsx',
        'src/types/**',
        'eslint.config.js',
        'vite.config.ts',
        'vitest.config.ts',
      ],
    },
  },
})
