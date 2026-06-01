import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dashboard } from './pages/Dashboard'
import { AddDevice } from './pages/AddDevice'
import { DeviceWizard } from './pages/DeviceWizard'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 2000,
    },
  },
})

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="font-bold text-gray-900 text-sm tracking-tight">
          the-decommissioner
        </Link>
        <span className="text-gray-300">|</span>
        <Link to="/" className="text-sm text-gray-600 hover:text-gray-900">Dashboard</Link>
        <Link to="/devices/new" className="text-sm text-gray-600 hover:text-gray-900">Add Device</Link>
      </nav>
      <main>{children}</main>
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
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
