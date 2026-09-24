import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../../src/context/AuthContext'
import Agenda from '../../src/pages/admin/Agenda'
import Services from '../../src/pages/admin/Services'
import ClientLayout from '../../src/components/layouts/ClientLayout'
import Schedule from '../../src/pages/client/Schedule'
import '../../src/index.css'

const root = createRoot(document.getElementById('root')!)
const page = new URLSearchParams(location.search).get('page')
function render() {
  root.render(<BrowserRouter><AuthProvider>
    {page === 'schedule' ? <ClientLayout><Schedule /></ClientLayout> :
      <main className="p-4">{page === 'services' ? <Services /> : <Agenda />}</main>}
  </AuthProvider></BrowserRouter>)
}
Object.assign(window, { auditRender: render, auditUnmount: () => root.unmount() })
render()
