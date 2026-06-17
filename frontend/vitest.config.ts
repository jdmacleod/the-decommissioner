import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 88, functions: 70, branches: 84, statements: 88 },
      exclude: [
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        '**/*.d.ts',
        'src/App.tsx',
        'src/types/**',
      ],
    },
  },
})
