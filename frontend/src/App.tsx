import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
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

function MobileTopBar() {
  return (
    <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-10">
      <Link to="/" className="font-bold text-gray-900 text-sm tracking-tight">
        ◈ the-decommissioner
      </Link>
      <div className="flex items-center gap-4">
        <Link to="/devices/new" className="text-sm text-blue-600">
          + Add
        </Link>
        <Link to="/settings" className="text-sm text-gray-500">
          ⚙
        </Link>
      </div>
    </div>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50 md:flex-row">
      <DeviceSidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        <MobileTopBar />
        <main className="flex-1">{children}</main>
      </div>
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
