import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DeviceSidebar } from './components/DeviceSidebar'
import { Dashboard } from './pages/Dashboard'
import { AddDevice } from './pages/AddDevice'
import { DeviceWizard } from './pages/DeviceWizard'
import { FileBrowser } from './stages/FileBrowser'
import { DuplicateResolver } from './stages/DuplicateResolver'
import { Settings } from './pages/Settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 2000 },
  },
})

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <DeviceSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/devices/new" element={<AddDevice />} />
            <Route path="/devices/:id" element={<DeviceWizard />} />
            <Route path="/devices/:id/files" element={<FileBrowser />} />
            <Route path="/devices/:id/duplicates" element={<DuplicateResolver />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
