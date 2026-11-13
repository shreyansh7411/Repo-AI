import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import App from '../App'
import { AuthPage } from './AuthPage'
import { useAuth } from './useAuth'

function SessionLoading() {
  return <main className="auth-page auth-loading"><div className="auth-loading-mark"><span className="auth-spinner" /></div><p>Checking your Repo-AI session…</p></main>
}

function ProtectedRoutes() {
  const { status } = useAuth()
  if (status === 'loading') return <SessionLoading />
  if (status !== 'authenticated') return <Navigate to="/login" replace />
  return <Outlet />
}

function PublicRoutes() {
  const { status } = useAuth()
  if (status === 'loading') return <SessionLoading />
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function UnknownRoute() {
  const { status } = useAuth()
  if (status === 'loading') return <SessionLoading />
  return <Navigate to={status === 'authenticated' ? '/dashboard' : '/login'} replace />
}

export function Application() {
  return <Routes>
    <Route element={<PublicRoutes />}>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
    </Route>
    <Route element={<ProtectedRoutes />}>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<App view="dashboard" />} />
      <Route path="/explorer" element={<App view="explorer" />} />
      <Route path="/symbols" element={<App view="symbols" />} />
      <Route path="/callers" element={<App view="callers" />} />
      <Route path="/impact" element={<App view="impact" />} />
      <Route path="/paths" element={<App view="paths" />} />
      <Route path="/assistant" element={<App view="assistant" />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Route>
    <Route path="*" element={<UnknownRoute />} />
  </Routes>
}
