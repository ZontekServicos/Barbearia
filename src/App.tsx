import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'

// Layouts
import ClientLayout from './components/layouts/ClientLayout'
import AdminLayout from './components/layouts/AdminLayout'

// Public
import Landing from './pages/Landing'
import Login from './pages/client/Login'

// Client area
import ClientHome from './pages/client/ClientHome'
import Schedule from './pages/client/Schedule'
import Appointments from './pages/client/Appointments'
import Profile from './pages/client/Profile'

// Admin area
import Dashboard from './pages/admin/Dashboard'
import Agenda from './pages/admin/Agenda'
import AppointmentDetail from './pages/admin/AppointmentDetail'
import Clients from './pages/admin/Clients'
import ClientProfile from './pages/admin/ClientProfile'
import Services from './pages/admin/Services'
import AdminSettings from './pages/admin/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />

        {/* Client area */}
        <Route
          path="/client"
          element={<ClientLayout><ClientHome /></ClientLayout>}
        />
        <Route
          path="/client/schedule"
          element={<ClientLayout><Schedule /></ClientLayout>}
        />
        <Route
          path="/client/appointments"
          element={<ClientLayout><Appointments /></ClientLayout>}
        />
        <Route
          path="/client/profile"
          element={<ClientLayout><Profile /></ClientLayout>}
        />

        {/* Admin area */}
        <Route
          path="/admin"
          element={<AdminLayout><Dashboard /></AdminLayout>}
        />
        <Route
          path="/admin/agenda"
          element={<AdminLayout><Agenda /></AdminLayout>}
        />
        <Route
          path="/admin/agenda/:id"
          element={<AdminLayout><AppointmentDetail /></AdminLayout>}
        />
        <Route
          path="/admin/clients"
          element={<AdminLayout><Clients /></AdminLayout>}
        />
        <Route
          path="/admin/clients/:id"
          element={<AdminLayout><ClientProfile /></AdminLayout>}
        />
        <Route
          path="/admin/services"
          element={<AdminLayout><Services /></AdminLayout>}
        />
        <Route
          path="/admin/settings"
          element={<AdminLayout><AdminSettings /></AdminLayout>}
        />
        <Route path="*" element={
          <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
            <h1 className="text-2xl font-bold">Página não encontrada</h1>
            <Link to="/" className="text-[var(--primary)] underline">Voltar ao início</Link>
          </main>
        } />
      </Routes>
    </BrowserRouter>
  )
}
