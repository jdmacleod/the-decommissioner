import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'

export function renderWithProviders(
  ui: ReactElement,
  { initialPath = '/', routePath = '/' }: { initialPath?: string; routePath?: string } = {}
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path={routePath} element={ui} />
          <Route path="*" element={<div data-testid="navigated" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}
