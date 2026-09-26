import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../../src/context/AuthContext'
import Agenda from '../../src/pages/admin/Agenda'
import Services from '../../src/pages/admin/Services'
import ClientLayout from '../../src/components/layouts/ClientLayout'
import Schedule from '../../src/pages/client/Schedule'
import BookingStatus from '../../src/pages/client/BookingStatus'
import '../../src/index.css'

const root = createRoot(document.getElementById('root')!)
const page = new URLSearchParams(location.search).get('page')
const routeToken = new URLSearchParams(location.search).get('token')
function render() {
  // 'status-route' monta a rota real /agendamento/:token para provar que o
  // token vem da URL — é assim que alguém volta dias depois pelo link.
  if (page === 'status-route') {
    root.render(<MemoryRouter initialEntries={['/agendamento/' + routeToken]}><AuthProvider>
      <main className="max-w-md mx-auto w-full px-4 py-6">
        <Routes><Route path="/agendamento/:token" element={<BookingStatus />} /></Routes>
      </main>
    </AuthProvider></MemoryRouter>)
    return
  }
  root.render(<BrowserRouter><AuthProvider>
    {page === 'schedule' ? <ClientLayout><Schedule /></ClientLayout> :
      page === 'status' ? <main className="max-w-md mx-auto w-full px-4 py-6"><BookingStatus /></main> :
      <main className="p-4">{page === 'services' ? <Services /> : <Agenda />}</main>}
  </AuthProvider></BrowserRouter>)
}
Object.assign(window, { auditRender: render, auditUnmount: () => root.unmount() })
render()
