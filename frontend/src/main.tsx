import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { SessionProvider } from '@/features/auth/session'
import { initI18n } from '@/i18n/i18n-instance'
import { router } from './routes'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  // index.html owns the mount point; a missing element is a build error, not a runtime state.
  throw new Error('index.html must contain <div id="root">')
}
const mountNode = rootElement

const queryClient = new QueryClient()

// Before the first render, so no component paints an unresolved key.
initI18n()

async function bootstrap() {
  // MSW serves only the `/mock-api/*` domain of pages without a backend yet;
  // `/auth`, `/api` and the session cookie pass through to the gateway.
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })

  createRoot(mountNode).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
