import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './auth/AuthContext.tsx'
import { Application } from './auth/Application.tsx'
import { HashRouter } from 'react-router-dom'
import { ThemeProvider } from './theme/ThemeProvider.tsx'
import './design-system.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <ThemeProvider>
          <Application />
        </ThemeProvider>
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
