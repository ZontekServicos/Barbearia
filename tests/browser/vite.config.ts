import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export default defineConfig({
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
  plugins: [
    {
      name: 'audit-historical-agenda',
      enforce: 'pre',
      load(id) {
        // Optional, test-only reproduction using the ACTUAL prior component.
        const ref = process.env.LEGACY_AGENDA_REF
        if (ref && id.replaceAll('\\', '/').endsWith('/src/pages/admin/Agenda.tsx')) {
          return execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`,
            'show', `${ref}:src/pages/admin/Agenda.tsx`], { encoding: 'utf8' })
        }
      },
    },
    react(), tailwindcss(),
  ],
  resolve: { alias: { '@': resolve(process.cwd(), 'src') } },
  server: { host: '127.0.0.1', port: 8444, strictPort: true },
})
