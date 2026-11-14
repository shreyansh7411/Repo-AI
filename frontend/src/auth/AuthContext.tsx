import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, type AuthUser } from '../api/client'
import { AuthContext, type AuthStatus } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let active = true
    const onUnauthorized = () => {
      setUser(null)
      setStatus('unauthenticated')
    }
    window.addEventListener('repo-ai:unauthorized', onUnauthorized)
    authApi.me().then(({ user: sessionUser }) => {
      if (!active) return
      setUser(sessionUser)
      setStatus('authenticated')
    }).catch(() => {
      if (!active) return
      setUser(null)
      setStatus('unauthenticated')
    })
    return () => {
      active = false
      window.removeEventListener('repo-ai:unauthorized', onUnauthorized)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password)
    setUser(response.user)
    setStatus('authenticated')
  }, [])

  const register = useCallback(async (name: string, email: string, password: string) => {
    const response = await authApi.register(name, email, password)
    setUser(response.user)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      setStatus('unauthenticated')
    }
  }, [])

  const updateProfile = useCallback(async (name: string) => {
    const response = await authApi.updateProfile(name)
    setUser(response.user)
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const response = await authApi.changePassword(currentPassword, newPassword)
    setUser(response.user)
  }, [])

  const value = useMemo(() => ({ status, user, login, register, logout, updateProfile, changePassword }), [status, user, login, register, logout, updateProfile, changePassword])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
