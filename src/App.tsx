import { BrowserRouter, Routes, Route, Link } from "react-router-dom"

import { AuthProvider } from "./context/AuthContext"
import {
  RequireActiveAccount,
  RequireAdmin,
  RequireAuth,
} from "./components/RouteGuards"

// Layouts
import ClientLayout from "./components/layouts/ClientLayout"
import AdminLayout from "./components/layouts/AdminLayout"

// Public
import Landing from "./pages/Landing"
import Login from "./pages/client/Login"
import Register from "./pages/client/Register"
import PublicBooking from "./pages/PublicBooking"
import PublicBookingStatus from "./pages/PublicBookingStatus"

// Client area
import ClientHome from "./pages/client/ClientHome"
import Schedule from "./pages/client/Schedule"
import Appointments from "./pages/client/Appointments"
import Profile from "./pages/client/Profile"
import { AccountBlocked, PendingApproval } from "./pages/client/AccountStatus"

// Admin area
import Dashboard from "./pages/admin/Dashboard"
import Agenda from "./pages/admin/Agenda"
import AppointmentDetail from "./pages/admin/AppointmentDetail"
import Clients from "./pages/admin/Clients"
import ClientProfile from "./pages/admin/ClientProfile"
import Services from "./pages/admin/Services"
import AdminSettings from "./pages/admin/Settings"
import AdminUsers from "./pages/admin/Users"

/** Tela do cliente: exige sessão e conta aprovada. */
function ClientPage({ children }: { children: React.ReactNode }) {
  return (
    <RequireActiveAccount>
      <ClientLayout>{children}</ClientLayout>
    </RequireActiveAccount>
  )
}

/** Tela administrativa: exige sessão e papel ADMIN (revalidado no backend). */
function AdminPage({ children }: { children: React.ReactNode }) {
  return (
    <RequireAdmin>
      <AdminLayout>{children}</AdminLayout>
    </RequireAdmin>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Público */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />

          {/*
            Agendamento público: serviço, data e horário podem ser escolhidos
            antes de existir conta. A confirmação exige sessão e conta
            aprovada — quem decide isso é o backend, não esta rota.
          */}
          <Route path="/agendar" element={<PublicBooking />} />
          {/*
            Acompanhamento de UMA solicitação: aprovação, pagamento e
            confirmação. Pública porque a chave é o token do pedido, não uma
            sessão — telefone não abre nada aqui.

            Com e sem parâmetro: o link que a pessoa recebe traz o token, e
            quem volta do mesmo navegador cai no comprovante guardado.
          */}
          <Route path="/agendamento" element={<PublicBookingStatus />} />
          <Route path="/agendamento/:token" element={<PublicBookingStatus />} />

          {/* Estados de conta — exigem sessão, mas não conta aprovada */}
          <Route
            path="/conta/pendente"
            element={
              <RequireAuth>
                <PendingApproval />
              </RequireAuth>
            }
          />
          <Route path="/conta/bloqueada" element={<AccountBlocked />} />

          {/* Área do cliente */}
          <Route
            path="/client"
            element={
              <ClientPage>
                <ClientHome />
              </ClientPage>
            }
          />
          <Route
            path="/client/schedule"
            element={
              <ClientPage>
                <Schedule />
              </ClientPage>
            }
          />
          <Route
            path="/client/appointments"
            element={
              <ClientPage>
                <Appointments />
              </ClientPage>
            }
          />
          <Route
            path="/client/profile"
            element={
              <RequireAuth>
                <ClientLayout>
                  <Profile />
                </ClientLayout>
              </RequireAuth>
            }
          />

          {/* Área administrativa */}
          <Route
            path="/admin"
            element={
              <AdminPage>
                <Dashboard />
              </AdminPage>
            }
          />
          <Route
            path="/admin/users"
            element={
              <AdminPage>
                <AdminUsers />
              </AdminPage>
            }
          />
          <Route
            path="/admin/agenda"
            element={
              <AdminPage>
                <Agenda />
              </AdminPage>
            }
          />
          <Route
            path="/admin/agenda/:id"
            element={
              <AdminPage>
                <AppointmentDetail />
              </AdminPage>
            }
          />
          <Route
            path="/admin/clients"
            element={
              <AdminPage>
                <Clients />
              </AdminPage>
            }
          />
          <Route
            path="/admin/clients/:id"
            element={
              <AdminPage>
                <ClientProfile />
              </AdminPage>
            }
          />
          <Route
            path="/admin/services"
            element={
              <AdminPage>
                <Services />
              </AdminPage>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <AdminPage>
                <AdminSettings />
              </AdminPage>
            }
          />

          <Route
            path="*"
            element={
              <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
                <h1 className="text-2xl font-bold">Página não encontrada</h1>
                <Link to="/" className="text-[var(--primary)] underline">
                  Voltar ao início
                </Link>
              </main>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
