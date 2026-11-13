import { useEffect, useSyncExternalStore } from 'react'
import App from '../App'
import { useAuth } from './useAuth'
import { AuthPage } from './AuthPage'
import { getCurrentPath, navigate, subscribeToPath } from './navigation'

function SessionLoading() {
  return <main className="auth-page auth-loading"><div className="auth-loading-mark"><span className="auth-spinner" /></div><p>Checking your Repo-AI session…</p></main>
}

function RedirectToWorkspace() {
  useEffect(() => navigate('/', true), [])
  return <SessionLoading />
}

export function Application() {
  const { status } = useAuth()
  const path = useSyncExternalStore(subscribeToPath, getCurrentPath, () => '/')

  if (status === 'loading') return <SessionLoading />
  if (status === 'authenticated') {
    if (path === '/login' || path === '/register') return <RedirectToWorkspace />
    return <App />
  }

  return <AuthPage mode={path === '/register' ? 'register' : 'login'} />
}
